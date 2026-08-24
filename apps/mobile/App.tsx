import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker, Polyline } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Speech from "expo-speech";
import { DetectionPipeline, makeSamples, classifyWithModel } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import type { JoltEvent, LatLng, SensorSample, Vec3 } from "@potholeproof/shared-types";
import { useAuth } from "./auth/AuthContext";
import { Badge, Button, Card, ConfidenceBar, EmptyState, IconButton, SeverityBadge } from "./components/ui";
import { classify, colors, durations, fontFamily, radii, space, typeScale, useAppFonts, useCountUp, usePhaseFade } from "./theme";
import SignInScreen from "./screens/SignInScreen";
import AdminScreen from "./screens/AdminScreen";
import NavigateScreen from "./screens/NavigateScreen";
import ModelInfoScreen from "./screens/ModelInfoScreen";
import CompareScreen from "./screens/CompareScreen";
import SideNavbar from "./components/SideNavbar";
import { isAdminEmail } from "./adminAuth";
import {
  deleteDriveFromCloud,
  subscribeToUserDrives,
  syncDriveToCloud,
  upsertUserProfile,
  type CloudDrive,
} from "./cloudDrives";

const G = 9.81; // expo-sensors accelerometer reports g-force incl. gravity
const SENSOR_INTERVAL_MS = 20; // request ~50 Hz
const DRAIN_INTERVAL_MS = 300;
const CONFIRM_WINDOW_MS = 6000;
const SERVER_KEY = "pp.server.url";
const ANON_KEY = "pp.anon.id";
// Small MLP trained on synthetic, physically-parameterised sensor windows
// (packages/detector/src/scripts/gen-training-data.ts). Runs as a pure-JS
// forward pass (packages/detector/src/model.ts) since native TFLite can't
// run in Expo Go. See the in-app "How the AI works" screen for real metrics.
const MODEL_VERSION = "mlp-v1-synthetic";
const APP_VERSION = "0.2.0";

/** Local storage is namespaced per-account so switching accounts on one phone never leaks another user's cached data. */
function storageKeyFor(uid: string): string {
  return `pp.labeled.v1.${uid}`;
}
function routesKeyFor(uid: string): string {
  return `pp.routes.v1.${uid}`;
}

type Label = "pothole" | "not_pothole";
interface LabeledEvent {
  event: JoltEvent;
  label: Label;
  /** Groups events from the same drive so saved data can be reopened/edited together. Absent on data saved before this existed. */
  driveId?: string;
}

type Phase =
  | "idle"
  | "driving"
  | "review"
  | "library"
  | "admin"
  | "navigate"
  | "modelInfo"
  | "compare";

/** Stable grouping key — falls back to the capture date for data saved before driveId existed. */
function driveKeyOf(item: LabeledEvent): string {
  return item.driveId ?? `legacy-${item.event.capturedAt.slice(0, 10)}`;
}

interface DriveGroup {
  driveId: string;
  items: LabeledEvent[];
  latestAt: string;
}

/** Shape of a row from GET /v1/training-data (services/ingestion) — local mirror, not a shared wire type. */
interface ServerTrainingRow {
  id: string;
  capturedAt: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number;
  severity: number;
  confidence: number;
  classification: string;
  modelVersion: string;
  label: Label | null;
}

/** Cloud sync should never silently fail — surface real errors while we're bringing this up. */
function syncCloud(label: string, fn: () => Promise<void>) {
  fn().catch((err: unknown) => {
    console.error(`[cloud] ${label} failed:`, err);
    Alert.alert(
      `Cloud sync failed (${label})`,
      String((err as { message?: string })?.message ?? err)
    );
  });
}

function isLabeledEvent(x: unknown): x is LabeledEvent {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.label !== "pothole" && o.label !== "not_pothole") return false;
  const e = o.event as Record<string, unknown> | undefined;
  return !!e && typeof e.id === "string" && typeof e.capturedAt === "string";
}

function groupLibraryByDrive(items: LabeledEvent[]): DriveGroup[] {
  const byKey = new Map<string, LabeledEvent[]>();
  for (const item of items) {
    const key = driveKeyOf(item);
    const group = byKey.get(key);
    if (group) group.push(item);
    else byKey.set(key, [item]);
  }
  return [...byKey.entries()]
    .map(([driveId, groupItems]) => ({
      driveId,
      items: groupItems.sort((a, b) => a.event.capturedAt.localeCompare(b.event.capturedAt)),
      latestAt: groupItems.reduce(
        (max, i) => (i.event.capturedAt > max ? i.event.capturedAt : max),
        groupItems[0]!.event.capturedAt
      ),
    }))
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

/**
 * Piecewise-linear speed profile, m/s, with keyframes at [ms, speed]. Models a
 * real local drive: pull away → residential cruise → stop → pull away again →
 * ramp onto an arterial → highway-ish cruise → slow to arrival.
 */
function speedAtKeyframes(tMs: number, keyframes: [number, number][]): number {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, s0] = keyframes[i]!;
    const [t1, s1] = keyframes[i + 1]!;
    if (tMs >= t0 && tMs <= t1) {
      const f = t1 === t0 ? 0 : (tMs - t0) / (t1 - t0);
      return s0 + (s1 - s0) * f;
    }
  }
  return keyframes[keyframes.length - 1]![1];
}

const DEMO_SPEED_KEYFRAMES: [number, number][] = [
  [0, 1], // stopped at the curb
  [3000, 8], // pulling away, residential
  [10000, 8], // residential cruise, ~18 mph
  [13000, 3], // slowing for a stop sign
  [16000, 8], // pulling away again
  [26000, 21], // ramping onto an arterial, ~47 mph
  [38000, 21], // arterial/highway-ish cruise
  [50000, 3], // slowing into the destination neighborhood
];

function demoSpeedAt(tMs: number): number {
  const wobble = Math.sin(tMs / 1000) * 0.6; // small natural speed wobble
  return Math.max(0.5, speedAtKeyframes(tMs, DEMO_SPEED_KEYFRAMES) + wobble);
}

/** A ~50s simulated drive through Bellevue, WA 98005: real detector, varied
 *  speed profile, synthetic road covering a broad range of situations. */
function buildDemoDrive(): { samples: SensorSample[]; gps: GpsFix[] } {
  const DURATION_MS = 50000;
  const samples = makeSamples({
    durationMs: DURATION_MS,
    rateHz: 50,
    noise: 0.35,
    gyroNoise: 0.03,
    seed: 7,
    impulses: [
      { atMs: 2000, peak: 3, kind: "rounded", widthMs: 150 }, // ambiguous jiggle, pulling away
      { atMs: 6500, peak: 10, kind: "sharp" }, // pothole, residential
      { atMs: 9000, peak: 7, kind: "rounded", gyroPeak: 1.3 }, // speed bump, residential
      { atMs: 14500, peak: 8, kind: "sharp" }, // pothole while slowed for the stop sign
      { atMs: 20000, peak: 6.5, kind: "rounded", widthMs: 260, gyroPeak: 1.0 }, // speed bump, pulling away
      { atMs: 28000, peak: 13, kind: "sharp" }, // moderate pothole, ramping onto the arterial
      { atMs: 33000, peak: 6, kind: "rounded", widthMs: 340 }, // rough patch, no clean impulse
      { atMs: 40000, peak: 19, kind: "sharp" }, // severe pothole at highway-ish speed
      { atMs: 45000, peak: 8, kind: "rounded", gyroPeak: 1.8 }, // speed bump, still fast
      { atMs: 48000, peak: 6, kind: "sharp" }, // small pothole, arriving
    ],
  });
  // West Bellevue, WA (zip 98005).
  const base = { lat: 47.6101, lng: -122.173 };
  const gps: GpsFix[] = [];
  let lat = base.lat;
  for (let t = 0; t <= DURATION_MS; t += 1000) {
    const speedMps = demoSpeedAt(t);
    gps.push({
      t,
      capturedAt: new Date(1_760_000_000_000 + t).toISOString(),
      location: { lat, lng: base.lng },
      speedMps,
      heading: 0,
    });
    lat += speedMps / 111320; // integrate position over this 1s step
  }
  return { samples, gps };
}

/** Full-screen tap-to-confirm prompt, keyed per-detection by the caller so it
 *  remounts (and re-animates) fresh each time a new jolt fires. */
function ConfirmOverlay({ event, onConfirm }: { event: JoltEvent; onConfirm: () => void }) {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: durations.base, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }),
    ]).start();
    Animated.timing(barWidth, {
      toValue: 0,
      duration: CONFIRM_WINDOW_MS,
      useNativeDriver: false,
    }).start();
  }, []);

  return (
    <Pressable style={styles.confirmOverlay} onPress={onConfirm}>
      <Animated.View style={{ opacity, transform: [{ scale }], alignItems: "center" }}>
        <Badge label={`AI · ${Math.round(event.confidence * 100)}% confident`} icon="hardware-chip-outline" tone="dark" />
        <Text style={styles.confirmBig}>Tap to confirm pothole</Text>
        <Text style={styles.confirmSub}>
          {event.classification.replace("_", " ")} detected · ignore to decide later
        </Text>
      </Animated.View>
      <View style={styles.confirmCountdownTrack}>
        <Animated.View
          style={[
            styles.confirmCountdownFill,
            { width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
          ]}
        />
      </View>
    </Pressable>
  );
}

export default function App() {
  const [fontsLoaded] = useAppFonts();
  const { user, initializing, logOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [isDemo, setIsDemo] = useState(false);
  const [events, setEvents] = useState<JoltEvent[]>([]);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [speedMps, setSpeedMps] = useState(0);
  const [sampleHz, setSampleHz] = useState(0);
  const [gpsOk, setGpsOk] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState<LabeledEvent[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<JoltEvent | null>(null);
  const [editingDriveId, setEditingDriveId] = useState<string | null>(null);
  const [showImportBox, setShowImportBox] = useState(false);
  const [importText, setImportText] = useState("");
  const [importingFromServer, setImportingFromServer] = useState(false);
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);
  const [cloudDrives, setCloudDrives] = useState<CloudDrive[]>([]);
  const cloudEventCount = cloudDrives.reduce((sum, d) => sum + d.items.length, 0);
  const animatedEventCount = useCountUp(cloudEventCount);
  const fade = usePhaseFade(phase);

  const pipeline = useRef<DetectionPipeline | null>(null);
  const liveLabels = useRef<Record<string, Label>>({});
  const driveIdRef = useRef<string>("");
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buffer = useRef<SensorSample[]>([]);
  const lastGyro = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const routeRef = useRef<LatLng[]>([]);
  const seq = useRef(0);
  const subs = useRef<{ remove: () => void }[]>([]);
  const drainTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const demo = useRef<{
    samples: SensorSample[];
    gps: GpsFix[];
    cursor: number;
    gpsCursor: number;
    clockMs: number;
  } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(SERVER_KEY).then((v) => v && setServerUrl(v));
  }, []);

  /** Local per-account count + live cloud subscription — both re-derive whenever the signed-in account changes. */
  useEffect(() => {
    if (!user) {
      setSavedCount(null);
      setCloudDrives([]);
      return;
    }
    AsyncStorage.getItem(storageKeyFor(user.uid)).then((raw) =>
      setSavedCount(raw ? (JSON.parse(raw) as unknown[]).length : 0)
    );
    syncCloud("profile", () => upsertUserProfile(user.uid, user.email, user.displayName));
    return subscribeToUserDrives(user.uid, setCloudDrives);
  }, [user]);

  if (!fontsLoaded || initializing) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  // A plain, never-null binding — TS doesn't carry `user`'s narrowing into the
  // `function`-declaration closures below, but a `const string` needs none.
  const uid = user.uid;

  function freshPipeline() {
    pipeline.current = new DetectionPipeline({
      nextId: () => `evt-${Date.now()}-${++seq.current}`,
      modelVersion: MODEL_VERSION,
      classify: classifyWithModel,
    });
    buffer.current = [];
    liveLabels.current = {};
    routeRef.current = [];
    driveIdRef.current = `drive-${Date.now()}`;
    setEditingDriveId(null);
    setEvents([]);
    setLabels({});
    setRoutePoints([]);
    setSampleHz(0);
    setPendingConfirm(null);
  }

  /** Speak the detection and open a 6 s tap-anywhere confirm window. */
  function announce(found: JoltEvent[]) {
    const latest = found[found.length - 1]!;
    const what =
      latest.classification === "pothole"
        ? "Pothole?"
        : latest.classification === "speed_bump"
          ? "Speed bump?"
          : "Rough road?";
    Speech.stop();
    Speech.speak(`${what} Tap to confirm pothole.`, { rate: 1.05 });
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setPendingConfirm(latest);
    confirmTimer.current = setTimeout(() => setPendingConfirm(null), CONFIRM_WINDOW_MS);
  }

  function confirmPothole() {
    if (!pendingConfirm) return;
    liveLabels.current[pendingConfirm.id] = "pothole";
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setPendingConfirm(null);
    Speech.stop();
    Speech.speak("Confirmed.");
    Vibration.vibrate(60);
  }

  async function startDrive() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Location needed",
        "Without location, detected potholes can't be placed on the map."
      );
      return;
    }
    freshPipeline();
    setIsDemo(false);
    setGpsOk(false);

    Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    subs.current.push(
      Gyroscope.addListener((g) => {
        lastGyro.current = { x: g.x, y: g.y, z: g.z };
      })
    );
    subs.current.push(
      Accelerometer.addListener((a) => {
        buffer.current.push({
          t: Date.now(),
          accel: { x: a.x * G, y: a.y * G, z: a.z * G },
          gyro: lastGyro.current,
        });
      })
    );
    subs.current.push(
      await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (loc) => {
          const heading = loc.coords.heading;
          const fix: GpsFix = {
            t: loc.timestamp,
            capturedAt: new Date(loc.timestamp).toISOString(),
            location: { lat: loc.coords.latitude, lng: loc.coords.longitude },
            speedMps: Math.max(0, loc.coords.speed ?? 0),
            ...(heading !== null && heading >= 0 ? { heading } : {}),
          };
          pipeline.current?.pushGps(fix);
          routeRef.current.push(fix.location);
          setGpsOk(true);
          setSpeedMps(Math.max(0, loc.coords.speed ?? 0));
        }
      )
    );

    drainTimer.current = setInterval(() => {
      const batch = buffer.current.splice(0);
      setSampleHz(Math.round((batch.length * 1000) / DRAIN_INTERVAL_MS));
      const found = pipeline.current?.push(batch) ?? [];
      if (found.length > 0) {
        Vibration.vibrate(150);
        setEvents((prev) => [...prev, ...found]);
        announce(found);
      }
    }, DRAIN_INTERVAL_MS);

    setPhase("driving");
  }

  /** Simulated drive through the REAL detection pipeline — for demos. */
  function startDemoDrive() {
    freshPipeline();
    setIsDemo(true);
    setGpsOk(true);
    demo.current = { ...buildDemoDrive(), cursor: 0, gpsCursor: 0, clockMs: 0 };

    drainTimer.current = setInterval(() => {
      const d = demo.current;
      if (!d || !pipeline.current) return;
      d.clockMs += DRAIN_INTERVAL_MS;

      while (
        d.gpsCursor < d.gps.length &&
        d.gps[d.gpsCursor]!.t <= d.clockMs
      ) {
        const fix = d.gps[d.gpsCursor]!;
        pipeline.current.pushGps(fix);
        routeRef.current.push(fix.location);
        setSpeedMps(fix.speedMps);
        d.gpsCursor++;
      }

      const batch: SensorSample[] = [];
      while (
        d.cursor < d.samples.length &&
        d.samples[d.cursor]!.t <= d.clockMs
      ) {
        batch.push(d.samples[d.cursor]!);
        d.cursor++;
      }
      setSampleHz(Math.round((batch.length * 1000) / DRAIN_INTERVAL_MS));
      const found = pipeline.current.push(batch);
      if (found.length > 0) {
        Vibration.vibrate(150);
        setEvents((prev) => [...prev, ...found]);
        announce(found);
      }
      if (d.cursor >= d.samples.length) stopDrive();
    }, DRAIN_INTERVAL_MS);

    setPhase("driving");
  }

  function stopDrive() {
    if (drainTimer.current) clearInterval(drainTimer.current);
    drainTimer.current = null;
    for (const s of subs.current) s.remove();
    subs.current = [];
    const tail = pipeline.current?.flush() ?? [];
    if (tail.length > 0) setEvents((prev) => [...prev, ...tail]);
    pipeline.current = null;
    demo.current = null;
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setPendingConfirm(null);
    Speech.stop();
    // Voice-confirmed labels pre-fill the review screen.
    setLabels({ ...liveLabels.current });
    setRoutePoints([...routeRef.current]);
    setSpeedMps(0);
    setPhase("review");
  }

  function setLabel(id: string, label: Label) {
    setLabels((prev) => ({ ...prev, [id]: label }));
  }

  async function saveLabels() {
    if (isDemo) {
      // Demo detections are synthetic — never let them pollute training data.
      setEvents([]);
      setLabels({});
      setPhase("idle");
      return;
    }
    const labeled: LabeledEvent[] = events
      .filter((e) => labels[e.id])
      .map((e) => ({ event: e, label: labels[e.id]!, driveId: driveIdRef.current }));
    const raw = await AsyncStorage.getItem(storageKeyFor(uid));
    const existing: LabeledEvent[] = raw ? JSON.parse(raw) : [];
    const merged = [...existing, ...labeled];
    await AsyncStorage.setItem(storageKeyFor(uid), JSON.stringify(merged));
    await saveRoute(driveIdRef.current, routeRef.current);
    if (user && labeled.length > 0) {
      syncCloud("save drive", () =>
        syncDriveToCloud(
          uid,
          driveIdRef.current,
          labeled.map((l) => ({ event: l.event, label: l.label })),
          routeRef.current
        )
      );
    }
    setSavedCount(merged.length);
    setEvents([]);
    setLabels({});
    setPhase("idle");
  }

  async function exportTrainingData() {
    const raw = await AsyncStorage.getItem(storageKeyFor(uid));
    if (!raw || raw === "[]") {
      Alert.alert("Nothing yet", "Label some drives first.");
      return;
    }
    await Share.share({ message: raw, title: "StreetSmart training data" });
  }

  /** Merge incoming labeled events into local storage, deduped by event id. */
  async function mergeLabeledEvents(incoming: LabeledEvent[]): Promise<number> {
    const raw = await AsyncStorage.getItem(storageKeyFor(uid));
    const existing: LabeledEvent[] = raw ? JSON.parse(raw) : [];
    const byId = new Map(existing.map((l) => [l.event.id, l]));
    let added = 0;
    for (const item of incoming) {
      if (!byId.has(item.event.id)) added++;
      byId.set(item.event.id, item);
    }
    const merged = [...byId.values()];
    await AsyncStorage.setItem(storageKeyFor(uid), JSON.stringify(merged));
    setSavedCount(merged.length);
    return added;
  }

  function announceImport(title: string, added: number, total: number) {
    Alert.alert(
      title,
      `${added} new event${added === 1 ? "" : "s"} added` +
        (total - added > 0 ? ` (${total - added} already on this phone).` : ".")
    );
  }

  async function importTrainingData() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText.trim());
    } catch {
      Alert.alert(
        "Couldn't read that",
        "Paste the exact JSON text produced by Export training data."
      );
      return;
    }
    const incoming = Array.isArray(parsed) ? parsed.filter(isLabeledEvent) : [];
    if (incoming.length === 0) {
      Alert.alert("Couldn't read that", "Expected a list of labeled events.");
      return;
    }
    const added = await mergeLabeledEvents(incoming);
    setImportText("");
    setShowImportBox(false);
    announceImport("Imported", added, incoming.length);
  }

  /** Pull the labeled set back off the ingestion server (the reverse of upload). */
  async function importFromServer() {
    const base = serverUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) {
      Alert.alert(
        "Server URL needed",
        "Enter the server URL in the box below first, e.g. http://192.168.1.20:4477"
      );
      return;
    }
    setImportingFromServer(true);
    try {
      const res = await fetch(`${base}/v1/training-data`);
      if (!res.ok) throw new Error(`server said ${res.status}`);
      const body = (await res.json()) as { events: ServerTrainingRow[] };
      const incoming: LabeledEvent[] = (body.events ?? [])
        .filter((r) => r.label === "pothole" || r.label === "not_pothole")
        .map((r) => ({
          event: {
            id: r.id,
            capturedAt: r.capturedAt,
            location: { lat: r.lat, lng: r.lng },
            ...(r.heading != null ? { heading: r.heading } : {}),
            speedMps: r.speedMps,
            severity: r.severity,
            confidence: r.confidence,
            classification: r.classification as JoltEvent["classification"],
            modelVersion: r.modelVersion,
          },
          label: r.label!,
        }));
      if (incoming.length === 0) {
        Alert.alert("Nothing to import", "The server has no labeled events yet.");
        return;
      }
      const added = await mergeLabeledEvents(incoming);
      setShowImportBox(false);
      announceImport("Imported from server", added, incoming.length);
    } catch (err) {
      Alert.alert(
        "Import failed",
        `${String(err)}\n\nIs the server running and the phone on the same Wi-Fi?`
      );
    } finally {
      setImportingFromServer(false);
    }
  }

  /** Merges this device's local cache with this account's cloud drives (from any device) into one editable list. */
  async function openLibrary() {
    const raw = await AsyncStorage.getItem(storageKeyFor(uid));
    const local: LabeledEvent[] = raw ? JSON.parse(raw) : [];
    const cloud: LabeledEvent[] = cloudDrives.flatMap((d) =>
      d.items.map((it) => ({ event: it.event, label: it.label, driveId: d.driveId }))
    );
    const byId = new Map<string, LabeledEvent>();
    for (const item of [...cloud, ...local]) byId.set(item.event.id, item);
    setLibrary([...byId.values()]);
    setPhase("library");
  }

  /** Backfill every drive already on this phone up to Firestore — for data saved before cloud sync existed. */
  async function syncAllToCloud() {
    if (!user) return;
    setSyncingAll(true);
    try {
      const raw = await AsyncStorage.getItem(storageKeyFor(uid));
      const all: LabeledEvent[] = raw ? JSON.parse(raw) : [];
      if (all.length === 0) {
        Alert.alert("Nothing to sync", "No labeled events stored on this phone yet.");
        return;
      }
      const groups = groupLibraryByDrive(all);
      const routes = await loadRoutes();
      let ok = 0;
      const failures: string[] = [];
      for (const group of groups) {
        try {
          await syncDriveToCloud(
            uid,
            group.driveId,
            group.items.map((l) => ({ event: l.event, label: l.label })),
            routes[group.driveId] ?? []
          );
          ok++;
        } catch (err) {
          console.error(`[cloud] backfill of drive ${group.driveId} failed:`, err);
          failures.push(String((err as { message?: string })?.message ?? err));
        }
      }
      Alert.alert(
        "Cloud sync",
        `${ok} of ${groups.length} drive${groups.length === 1 ? "" : "s"} synced to Firestore.` +
          (failures.length > 0 ? `\n\nFirst error: ${failures[0]}` : "")
      );
    } finally {
      setSyncingAll(false);
    }
  }

  async function persistLibrary(next: LabeledEvent[]) {
    setLibrary(next);
    setSavedCount(next.length);
    await AsyncStorage.setItem(storageKeyFor(uid), JSON.stringify(next));
  }

  /** Per-drive GPS tracks, stored locally only — never exported/uploaded. */
  async function loadRoutes(): Promise<Record<string, LatLng[]>> {
    const raw = await AsyncStorage.getItem(routesKeyFor(uid));
    return raw ? JSON.parse(raw) : {};
  }

  async function saveRoute(driveId: string, points: LatLng[]) {
    if (points.length < 2) return;
    const routes = await loadRoutes();
    routes[driveId] = points;
    await AsyncStorage.setItem(routesKeyFor(uid), JSON.stringify(routes));
  }

  async function deleteDrive(driveId: string) {
    await persistLibrary(library.filter((l) => driveKeyOf(l) !== driveId));
    const routes = await loadRoutes();
    if (routes[driveId]) {
      delete routes[driveId];
      await AsyncStorage.setItem(routesKeyFor(uid), JSON.stringify(routes));
    }
    syncCloud("delete drive", () => deleteDriveFromCloud(uid, driveId));
  }

  /** Reopen a saved drive on the review screen, in edit mode. */
  async function openDriveForEdit(group: DriveGroup) {
    setEvents(group.items.map((l) => l.event));
    setLabels(Object.fromEntries(group.items.map((l) => [l.event.id, l.label])));
    setIsDemo(false);
    setEditingDriveId(group.driveId);
    const routes = await loadRoutes();
    setRoutePoints(routes[group.driveId] ?? []);
    setPhase("review");
  }

  function cancelDriveEdit() {
    setEditingDriveId(null);
    setEvents([]);
    setLabels({});
    setPhase("library");
  }

  function removeEventFromEditor(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setLabels((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveDriveEdits() {
    if (!editingDriveId) return;
    const updated: LabeledEvent[] = events
      .filter((e) => labels[e.id])
      .map((e) => ({ event: e, label: labels[e.id]!, driveId: editingDriveId }));
    const others = library.filter((l) => driveKeyOf(l) !== editingDriveId);
    await persistLibrary([...others, ...updated]);
    if (user) {
      if (updated.length > 0) {
        syncCloud("save drive", () =>
          syncDriveToCloud(
            uid,
            editingDriveId,
            updated.map((l) => ({ event: l.event, label: l.label })),
            routePoints
          )
        );
      } else {
        syncCloud("delete drive", () => deleteDriveFromCloud(uid, editingDriveId));
      }
    }
    setEditingDriveId(null);
    setEvents([]);
    setLabels({});
    setPhase("library");
  }

  function clearSaved() {
    Alert.alert(
      "Delete all saved data?",
      "Removes every labeled event cached on this phone. (Anything already synced to the cloud stays there.)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => {
            void persistLibrary([]);
            void AsyncStorage.removeItem(routesKeyFor(uid));
          },
        },
      ]
    );
  }

  async function uploadToServer() {
    const raw = await AsyncStorage.getItem(storageKeyFor(uid));
    if (!raw || raw === "[]") {
      Alert.alert("Nothing yet", "Label some drives first.");
      return;
    }
    const base = serverUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) {
      Alert.alert(
        "Server URL needed",
        "Enter the upload URL the server prints, e.g. http://192.168.1.20:4477"
      );
      return;
    }
    await AsyncStorage.setItem(SERVER_KEY, base);

    let anonId = await AsyncStorage.getItem(ANON_KEY);
    if (!anonId) {
      anonId = `anon-${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem(ANON_KEY, anonId);
    }

    const stored: LabeledEvent[] = JSON.parse(raw);
    const byId = new Map(stored.map((l) => [l.event.id, l]));
    const eventsToSend = [...byId.values()].map((l) => l.event);
    const labelMap = Object.fromEntries(
      [...byId.values()].map((l) => [l.event.id, l.label])
    );

    setUploading(true);
    try {
      const res = await fetch(`${base}/v1/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anonDeviceId: anonId,
          appVersion: APP_VERSION,
          sentAt: new Date().toISOString(),
          events: eventsToSend,
          labels: labelMap,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        stored?: number;
        duplicates?: number;
      };
      if (!res.ok || !body.ok) throw new Error(`server said ${res.status}`);
      Alert.alert(
        "Uploaded",
        `${body.stored ?? 0} new, ${body.duplicates ?? 0} already on server. ` +
          "Local copy kept — safe to re-upload anytime."
      );
    } catch (err) {
      Alert.alert(
        "Upload failed",
        `${String(err)}\n\nIs the server running and the phone on the same Wi-Fi?`
      );
    } finally {
      setUploading(false);
    }
  }

  if (phase === "review") {
    const pending = events.filter((e) => !labels[e.id]).length;
    const lats = [...events.map((e) => e.location.lat), ...routePoints.map((p) => p.lat)];
    const lngs = [...events.map((e) => e.location.lng), ...routePoints.map((p) => p.lng)];
    const region =
      lats.length > 0
        ? {
            latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
            longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            latitudeDelta: Math.max(0.004, (Math.max(...lats) - Math.min(...lats)) * 1.6),
            longitudeDelta: Math.max(0.004, (Math.max(...lngs) - Math.min(...lngs)) * 1.6),
          }
        : null;

    return (
      <Animated.View style={[styles.screen, { opacity: fade }]}>
        <StatusBar style="dark" />
        {editingDriveId && (
          <Pressable style={styles.backRow} onPress={cancelDriveEdit} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.brand.primary} />
            <Text style={styles.backRowText}>Saved data</Text>
          </Pressable>
        )}
        <Text style={typeScale.h1}>
          {editingDriveId ? "Edit drive" : isDemo ? "Demo results" : "Review drive"}
        </Text>
        <Text style={styles.sub}>
          {events.length} detection{events.length === 1 ? "" : "s"}
          {editingDriveId
            ? " · adjust labels or remove events, then save"
            : isDemo
              ? " · simulated — nothing will be saved"
              : " · confirm each one to build training data"}
        </Text>
        {region && (
          <MapView style={styles.map} initialRegion={region}>
            {routePoints.length > 1 && (
              <>
                <Polyline
                  coordinates={routePoints.map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng,
                  }))}
                  strokeColor={colors.status.info}
                  strokeWidth={4}
                />
                <Marker
                  coordinate={{
                    latitude: routePoints[0]!.lat,
                    longitude: routePoints[0]!.lng,
                  }}
                  pinColor={colors.status.success}
                  title="Start"
                />
                <Marker
                  coordinate={{
                    latitude: routePoints[routePoints.length - 1]!.lat,
                    longitude: routePoints[routePoints.length - 1]!.lng,
                  }}
                  pinColor={colors.neutral.ink}
                  title="End"
                />
              </>
            )}
            {events.map((e) => (
              <Marker
                key={e.id}
                coordinate={{ latitude: e.location.lat, longitude: e.location.lng }}
                pinColor={classify(e).color}
                title={e.classification.replace("_", " ")}
                description={`severity ${Math.round(e.severity * 100)}% · confidence ${Math.round(e.confidence * 100)}%`}
              />
            ))}
          </MapView>
        )}
        <FlatList
          style={{ flex: 1, alignSelf: "stretch" }}
          data={events}
          keyExtractor={(e) => e.id}
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-circle-outline"
              title="No jolts detected"
              message="Smooth roads this drive — nothing to review."
              tone="success"
            />
          }
          renderItem={({ item, index }) => {
            const label = labels[item.id];
            const info = classify(item);
            return (
              <Card style={styles.eventCard}>
                <View style={styles.cardRow}>
                  <SeverityBadge info={info} />
                  {editingDriveId && (
                    <Pressable
                      onPress={() => removeEventFromEditor(item.id)}
                      style={styles.trashBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.neutral.inkFaint} />
                    </Pressable>
                  )}
                </View>
                <Text style={styles.cardMeta}>
                  {new Date(item.capturedAt).toLocaleTimeString()} ·{" "}
                  {(item.speedMps * 2.237).toFixed(0)} mph · severity {Math.round(item.severity * 100)}%
                </Text>
                <View style={styles.aiRow}>
                  <Badge label={item.modelVersion} icon="hardware-chip-outline" tone="neutral" />
                  <ConfidenceBar
                    pct={item.confidence}
                    color={colors.brand.primary}
                    delayMs={Math.min(index, 6) * 30}
                  />
                  <Text style={styles.confidencePct}>{Math.round(item.confidence * 100)}%</Text>
                </View>
                {!isDemo && (
                  <View style={styles.row}>
                    <View style={styles.rowBtnFlex}>
                      <Button
                        label="Pothole"
                        icon="checkmark-outline"
                        variant={label === "pothole" ? "primary" : "outline"}
                        size="sm"
                        onPress={() => setLabel(item.id, "pothole")}
                      />
                    </View>
                    <View style={styles.rowBtnFlex}>
                      <Button
                        label="Not a pothole"
                        icon="close-outline"
                        variant={label === "not_pothole" ? "danger" : "outline"}
                        size="sm"
                        onPress={() => setLabel(item.id, "not_pothole")}
                      />
                    </View>
                  </View>
                )}
              </Card>
            );
          }}
        />
        <Button
          label={
            editingDriveId
              ? "Save changes"
              : isDemo
                ? "Done"
                : pending > 0
                  ? `Save (${pending} unlabeled skipped)`
                  : "Save labels"
          }
          onPress={editingDriveId ? saveDriveEdits : saveLabels}
          variant="primary"
          size="lg"
          style={styles.reviewSaveBtn}
        />
      </Animated.View>
    );
  }

  if (phase === "library") {
    const drives = groupLibraryByDrive(library);
    return (
      <Animated.View style={[styles.screen, { opacity: fade }]}>
        <StatusBar style="dark" />
        <Text style={typeScale.h1}>Saved data</Text>
        <Text style={styles.sub}>
          {library.length} labeled event{library.length === 1 ? "" : "s"} across{" "}
          {drives.length} drive{drives.length === 1 ? "" : "s"}
        </Text>
        <FlatList
          style={{ flex: 1, alignSelf: "stretch" }}
          data={drives}
          keyExtractor={(g) => g.driveId}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title="Nothing saved yet"
              message="Drives you label will show up here."
            />
          }
          renderItem={({ item: group }) => {
            const potholeCount = group.items.filter((l) => l.label === "pothole").length;
            return (
              <Pressable onPress={() => openDriveForEdit(group)}>
                <Card style={styles.eventCard}>
                  <View style={styles.cardRow}>
                    <Text style={[styles.cardTitle, { flex: 1 }]}>
                      {new Date(group.latestAt).toLocaleString()}
                    </Text>
                    <Pressable
                      onPress={() => deleteDrive(group.driveId)}
                      style={styles.trashBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.neutral.inkFaint} />
                    </Pressable>
                    <Ionicons name="chevron-forward" size={18} color={colors.neutral.inkDisabled} />
                  </View>
                  <Text style={styles.cardMeta}>
                    {group.items.length} event{group.items.length === 1 ? "" : "s"} ·{" "}
                    {potholeCount} pothole{potholeCount === 1 ? "" : "s"} confirmed
                  </Text>
                </Card>
              </Pressable>
            );
          }}
        />
        {library.length > 0 && (
          <Pressable style={styles.secondaryBtn} onPress={clearSaved}>
            <Text style={styles.dangerText}>Delete all</Text>
          </Pressable>
        )}
        <Button label="Done" onPress={() => setPhase("idle")} variant="primary" size="lg" style={styles.reviewSaveBtn} />
      </Animated.View>
    );
  }

  if (phase === "admin") {
    return <AdminScreen onClose={() => setPhase("idle")} />;
  }

  if (phase === "navigate") {
    return <NavigateScreen onClose={() => setPhase("idle")} />;
  }

  if (phase === "modelInfo") {
    return (
      <ModelInfoScreen onClose={() => setPhase("idle")} onOpenLab={() => setPhase("compare")} />
    );
  }

  if (phase === "compare") {
    return <CompareScreen onClose={() => setPhase("modelInfo")} />;
  }

  if (phase === "driving") {
    return (
      <Animated.View style={[styles.screen, styles.driveScreen, { opacity: fade }]}>
        <StatusBar style="light" />
        {isDemo && (
          <View style={styles.demoBadgeWrap}>
            <Badge label="Simulated drive" icon="play-outline" tone="warning" />
          </View>
        )}
        <Text style={styles.driveSpeed}>
          {(speedMps * 2.237).toFixed(0)}
          <Text style={styles.driveSpeedUnit}> mph</Text>
        </Text>
        <Text style={styles.driveStat}>
          sensors {sampleHz} Hz · GPS {gpsOk ? "✓" : "…"}
        </Text>
        <Text style={styles.driveCount}>{events.length}</Text>
        <Text style={styles.driveStat}>
          jolt{events.length === 1 ? "" : "s"} detected
        </Text>
        <Button label="End drive" onPress={stopDrive} variant="danger" size="lg" icon="stop-circle-outline" style={styles.stopBtnMargin} />
        <Text style={styles.driveHint}>
          {isDemo
            ? "Replaying a synthetic road through the real detector."
            : "Mount the phone, keep the app open, and drive normally."}
        </Text>
        {pendingConfirm && <ConfirmOverlay key={pendingConfirm.id} event={pendingConfirm} onConfirm={confirmPothole} />}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.screen, styles.homeScreen, { opacity: fade }]}>
      <StatusBar style="dark" />
      <SideNavbar
        visible={navOpen}
        onClose={() => setNavOpen(false)}
        displayName={user.displayName}
        email={user.email}
        contributedCount={cloudEventCount}
        isAdmin={isAdminEmail(user.email)}
        onNavigate={() => setPhase("navigate")}
        onContribute={startDrive}
        onOpenLibrary={openLibrary}
        onOpenAdmin={() => setPhase("admin")}
        onOpenModelInfo={() => setPhase("modelInfo")}
        onLogOut={logOut}
      />
      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={styles.homeContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.homeHeader}>
          <View style={styles.menuBtnWrap}>
            <IconButton icon="menu-outline" onPress={() => setNavOpen(true)} accessibilityLabel="Open menu" />
          </View>
          <Text style={styles.homeTitle}>StreetSmart</Text>
          <Text style={styles.homeTagline}>Every commute is a road survey.</Text>
        </View>

        <View style={styles.heroGroup}>
          <Button label="Start navigation" onPress={() => setPhase("navigate")} variant="primary" size="lg" icon="navigate" />
          <Button label="Survey roads" onPress={startDrive} variant="outline" size="lg" icon="construct-outline" />
          <Button label="Demo drive (simulated)" onPress={startDemoDrive} variant="outline" size="lg" icon="play-outline" />
        </View>

        <Pressable onPress={() => setPhase("modelInfo")}>
          <Card dark style={styles.aiCallout}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.white} style={styles.aiCalloutIcon} />
            <Text style={styles.aiCalloutText}>Potholes are classified by a trained AI model</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.neutral.inkFaint} />
          </Card>
        </Pressable>

        <Card style={styles.sectionCardMargin}>
          <Text style={typeScale.label}>Your data</Text>
          <View style={styles.statRow}>
            <Text style={[styles.statValue, !cloudEventCount && styles.statValueEmpty]}>
              {animatedEventCount}
            </Text>
            <Text style={styles.statCaption}>
              {cloudEventCount
                ? "labeled events contributed"
                : "No labeled events yet — drive to get started"}
            </Text>
          </View>
          <Text style={styles.statBreakdown}>
            {savedCount ?? 0} on this device · {cloudEventCount} synced to cloud
          </Text>
          <View style={styles.divider} />
          <Pressable style={styles.rowBtn} onPress={openLibrary}>
            <View style={styles.rowBtnLeft}>
              <Ionicons name="folder-outline" size={17} color={colors.neutral.ink} />
              <Text style={styles.rowBtnText}>Manage saved data</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.neutral.inkDisabled} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.rowBtn}
            onPress={syncAllToCloud}
            disabled={syncingAll}
          >
            <View style={styles.rowBtnLeft}>
              {syncingAll ? (
                <ActivityIndicator size="small" color={colors.neutral.inkSoft} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={17} color={colors.neutral.ink} />
              )}
              <Text style={styles.rowBtnText}>{syncingAll ? "Syncing…" : "Sync saved drives to cloud"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.neutral.inkDisabled} />
          </Pressable>
        </Card>

        <Text style={styles.homeFooter}>detector {MODEL_VERSION}</Text>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xxl,
    paddingTop: 72,
  },
  centerFill: { padding: 0, paddingTop: 0 },
  driveScreen: { backgroundColor: colors.dark.bg },
  backRow: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 6, marginBottom: 2 },
  backRowText: { color: colors.brand.primary, fontFamily: fontFamily.bodySemibold, fontSize: 15, marginLeft: 2 },
  sub: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    color: colors.neutral.inkSoft,
    textAlign: "center",
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  homeScreen: { justifyContent: "flex-start", alignItems: "stretch", padding: 0 },
  homeScroll: { flex: 1, alignSelf: "stretch" },
  homeContent: { paddingHorizontal: space.xl, paddingTop: 48, paddingBottom: space.xxxl + space.sm },
  homeHeader: { marginBottom: space.xxl },
  menuBtnWrap: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 1,
  },
  homeTitle: { ...typeScale.display },
  homeTagline: { fontFamily: fontFamily.body, fontSize: 15, color: colors.neutral.inkSoft, marginTop: 4 },
  heroGroup: { marginBottom: space.xxl },
  aiCallout: { flexDirection: "row", alignItems: "center", marginBottom: space.lg },
  aiCalloutIcon: { marginRight: space.md },
  aiCalloutText: { color: colors.white, fontFamily: fontFamily.bodyBold, fontSize: 14, flex: 1, marginRight: space.sm },
  sectionCardMargin: { marginBottom: space.lg },
  statRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  statValue: { fontFamily: fontFamily.mono, fontSize: 26, color: colors.status.success },
  statValueEmpty: { color: colors.neutral.inkDisabled },
  statBreakdown: { fontFamily: fontFamily.bodyMedium, fontSize: 12, color: colors.neutral.inkFaint, marginTop: 4 },
  statCaption: { flex: 1, fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.neutral.divider, marginVertical: 4 },
  rowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  rowBtnLeft: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowBtnText: { fontFamily: fontFamily.bodySemibold, fontSize: 15, color: colors.neutral.ink },
  uploadBtn: {
    backgroundColor: "#e8442e",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 10,
  },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  importBox: { marginTop: 4, paddingBottom: 4 },
  importInput: {
    alignSelf: "stretch",
    backgroundColor: "#f6f7f9",
    borderWidth: 1,
    borderColor: "#e3e6ea",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#1a1d21",
    minHeight: 90,
    textAlignVertical: "top",
  },
  importActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  importCancelBtn: { paddingVertical: 13, paddingHorizontal: 4 },
  importCancelText: { color: "#5b6570", fontSize: 15, fontWeight: "600" },
  importBtn: {
    backgroundColor: "#e8442e",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  importDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 10,
  },
  importDividerLine: { flex: 1, height: 1, backgroundColor: "#eef0f2" },
  importDividerText: { fontSize: 12, color: "#8a939d" },
  homeFooter: { textAlign: "center", color: colors.neutral.inkFaint, fontFamily: fontFamily.bodyMedium, fontSize: 12, marginTop: 4 },
  map: {
    alignSelf: "stretch",
    height: 220,
    borderRadius: radii.md,
    marginVertical: space.sm,
  },
  secondaryBtn: { marginTop: space.md, padding: space.sm },
  secondaryBtnText: { color: colors.brand.primary, fontFamily: fontFamily.bodySemibold, fontSize: 15 },
  dangerText: { color: colors.status.danger, fontFamily: fontFamily.bodyBold, fontSize: 15 },
  trashBtn: { padding: 6, marginLeft: space.sm },
  confirmOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(232,68,46,0.93)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  confirmBig: { color: colors.white, fontFamily: fontFamily.display, fontSize: 30, marginTop: space.md, textAlign: "center" },
  confirmSub: { color: colors.white, opacity: 0.9, marginTop: space.sm, fontFamily: fontFamily.bodyMedium, fontSize: 15, textAlign: "center" },
  confirmCountdownTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  confirmCountdownFill: { height: "100%", backgroundColor: colors.white },
  urlInput: {
    alignSelf: "stretch",
    backgroundColor: "#f6f7f9",
    borderWidth: 1,
    borderColor: "#e3e6ea",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1a1d21",
  },
  demoBadgeWrap: { position: "absolute", top: 64, zIndex: 1 },
  driveSpeed: { fontFamily: fontFamily.mono, fontSize: 80, color: colors.white },
  driveSpeedUnit: { fontFamily: fontFamily.body, fontSize: 20, color: colors.neutral.inkFaint },
  driveCount: { fontFamily: fontFamily.mono, fontSize: 56, color: colors.brand.primary, marginTop: space.xxl },
  driveStat: { fontFamily: fontFamily.bodyMedium, fontSize: 14, color: colors.neutral.inkFaint, marginTop: 4 },
  driveHint: {
    position: "absolute",
    bottom: 28,
    color: colors.neutral.inkSoft,
    fontFamily: fontFamily.body,
    fontSize: 13,
    textAlign: "center",
  },
  stopBtnMargin: { marginTop: space.xxxl, alignSelf: "stretch" },
  eventCard: { marginVertical: space.xs, alignSelf: "stretch" },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  cardTitle: { fontFamily: fontFamily.bodyBold, fontSize: 16, color: colors.neutral.ink },
  cardMeta: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft, marginTop: 2 },
  aiRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  confidencePct: { fontFamily: fontFamily.monoMedium, fontSize: 12, color: colors.neutral.inkSoft, width: 36, textAlign: "right" },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  rowBtnFlex: { flex: 1 },
  reviewSaveBtn: { marginTop: space.lg },
});
