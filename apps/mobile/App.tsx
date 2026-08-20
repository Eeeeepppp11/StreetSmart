import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
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
import MapView, { Marker, Polyline } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Speech from "expo-speech";
import { DetectionPipeline, makeSamples } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import type { JoltEvent, LatLng, SensorSample, Vec3 } from "@potholeproof/shared-types";
import { useAuth } from "./auth/AuthContext";
import SignInScreen from "./screens/SignInScreen";
import AdminScreen from "./screens/AdminScreen";
import NavigateScreen from "./screens/NavigateScreen";
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
const SERVER_KEY = "pp.server.url";
const ANON_KEY = "pp.anon.id";
const MODEL_VERSION = "heuristic-v0-expo";
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

type Phase = "idle" | "driving" | "review" | "library" | "admin" | "navigate";

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

/** Marker colour: potholes by severity, impostors muted. */
function pinColor(e: JoltEvent): string {
  if (e.classification === "pothole") {
    return e.severity >= 0.67 ? "#d92616" : e.severity >= 0.34 ? "#e8812e" : "#e6b91e";
  }
  if (e.classification === "speed_bump") return "#4a72da";
  return "#8a939d";
}

/** A ~35s simulated drive: real detector, synthetic road. */
function buildDemoDrive(): { samples: SensorSample[]; gps: GpsFix[] } {
  const samples = makeSamples({
    durationMs: 35000,
    rateHz: 50,
    noise: 0.35,
    gyroNoise: 0.03,
    seed: 7,
    impulses: [
      { atMs: 6000, peak: 11, kind: "sharp" }, // pothole
      { atMs: 13000, peak: 7, kind: "rounded", gyroPeak: 1.2 }, // speed bump
      { atMs: 20000, peak: 8.5, kind: "sharp" }, // moderate pothole
      { atMs: 29000, peak: 14, kind: "sharp" }, // severe pothole
    ],
  });
  const base = { lat: 37.7749, lng: -122.4194 };
  const speed = 13.4; // ~30 mph northbound
  const gps: GpsFix[] = [];
  for (let t = 0; t <= 35000; t += 1000) {
    gps.push({
      t,
      capturedAt: new Date(1_760_000_000_000 + t).toISOString(),
      location: { lat: base.lat + (speed * (t / 1000)) / 111320, lng: base.lng },
      speedMps: speed,
      heading: 0,
    });
  }
  return { samples, gps };
}

export default function App() {
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

  if (initializing) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#e8442e" />
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
    confirmTimer.current = setTimeout(() => setPendingConfirm(null), 6000);
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
    await Share.share({ message: raw, title: "PotholeProof training data" });
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
      <View style={styles.screen}>
        <StatusBar style="dark" />
        {editingDriveId && (
          <Pressable style={styles.backRow} onPress={cancelDriveEdit} hitSlop={8}>
            <Text style={styles.backRowText}>‹ Saved data</Text>
          </Pressable>
        )}
        <Text style={styles.h1}>
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
                  strokeColor="#4a72da"
                  strokeWidth={4}
                />
                <Marker
                  coordinate={{
                    latitude: routePoints[0]!.lat,
                    longitude: routePoints[0]!.lng,
                  }}
                  pinColor="#2e9e4f"
                  title="Start"
                />
                <Marker
                  coordinate={{
                    latitude: routePoints[routePoints.length - 1]!.lat,
                    longitude: routePoints[routePoints.length - 1]!.lng,
                  }}
                  pinColor="#1a1d21"
                  title="End"
                />
              </>
            )}
            {events.map((e) => (
              <Marker
                key={e.id}
                coordinate={{ latitude: e.location.lat, longitude: e.location.lng }}
                pinColor={pinColor(e)}
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
            <Text style={styles.sub}>No jolts detected this drive. Smooth roads!</Text>
          }
          renderItem={({ item }) => {
            const label = labels[item.id];
            return (
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={[styles.dot, { backgroundColor: pinColor(item) }]} />
                  <Text style={[styles.cardTitle, editingDriveId && { flex: 1 }]}>
                    {item.classification.replace("_", " ")} ·{" "}
                    {Math.round(item.severity * 100)}%
                  </Text>
                  {editingDriveId && (
                    <Pressable
                      onPress={() => removeEventFromEditor(item.id)}
                      style={styles.trashBtn}
                      hitSlop={8}
                    >
                      <Text style={styles.trashText}>🗑</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={styles.cardMeta}>
                  {new Date(item.capturedAt).toLocaleTimeString()} ·{" "}
                  {(item.speedMps * 2.237).toFixed(0)} mph ·{" "}
                  {Math.round(item.confidence * 100)}% confidence
                </Text>
                {!isDemo && (
                  <View style={styles.row}>
                    <Pressable
                      onPress={() => setLabel(item.id, "pothole")}
                      style={[styles.labelBtn, label === "pothole" && styles.labelYes]}
                    >
                      <Text style={styles.labelText}>✓ Pothole</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setLabel(item.id, "not_pothole")}
                      style={[styles.labelBtn, label === "not_pothole" && styles.labelNo]}
                    >
                      <Text style={styles.labelText}>✗ Not</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
        <Pressable
          style={styles.primaryBtn}
          onPress={editingDriveId ? saveDriveEdits : saveLabels}
        >
          <Text style={styles.primaryBtnText}>
            {editingDriveId
              ? "Save changes"
              : isDemo
                ? "Done"
                : pending > 0
                  ? `Save (${pending} unlabeled skipped)`
                  : "Save labels"}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "library") {
    const drives = groupLibraryByDrive(library);
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <Text style={styles.h1}>Saved data</Text>
        <Text style={styles.sub}>
          {library.length} labeled event{library.length === 1 ? "" : "s"} across{" "}
          {drives.length} drive{drives.length === 1 ? "" : "s"}
        </Text>
        <FlatList
          style={{ flex: 1, alignSelf: "stretch" }}
          data={drives}
          keyExtractor={(g) => g.driveId}
          ListEmptyComponent={<Text style={styles.sub}>Nothing saved yet.</Text>}
          renderItem={({ item: group }) => {
            const potholeCount = group.items.filter((l) => l.label === "pothole").length;
            return (
              <Pressable style={styles.card} onPress={() => openDriveForEdit(group)}>
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTitle, { flex: 1 }]}>
                    {new Date(group.latestAt).toLocaleString()}
                  </Text>
                  <Pressable
                    onPress={() => deleteDrive(group.driveId)}
                    style={styles.trashBtn}
                    hitSlop={8}
                  >
                    <Text style={styles.trashText}>🗑</Text>
                  </Pressable>
                  <Text style={styles.rowBtnChevron}>›</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {group.items.length} event{group.items.length === 1 ? "" : "s"} ·{" "}
                  {potholeCount} pothole{potholeCount === 1 ? "" : "s"} confirmed
                </Text>
              </Pressable>
            );
          }}
        />
        {library.length > 0 && (
          <Pressable style={styles.secondaryBtn} onPress={clearSaved}>
            <Text style={styles.dangerText}>Delete all</Text>
          </Pressable>
        )}
        <Pressable style={styles.primaryBtn} onPress={() => setPhase("idle")}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "admin") {
    return <AdminScreen onClose={() => setPhase("idle")} />;
  }

  if (phase === "navigate") {
    return <NavigateScreen onClose={() => setPhase("idle")} />;
  }

  if (phase === "driving") {
    return (
      <View style={[styles.screen, styles.driveScreen]}>
        <StatusBar style="light" />
        {isDemo && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>SIMULATED DRIVE</Text>
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
        <Pressable style={styles.stopBtn} onPress={stopDrive}>
          <Text style={styles.primaryBtnText}>END DRIVE</Text>
        </Pressable>
        <Text style={styles.driveHint}>
          {isDemo
            ? "Replaying a synthetic road through the real detector."
            : "Mount the phone, keep the app open, and drive normally."}
        </Text>
        {pendingConfirm && (
          <Pressable style={styles.confirmOverlay} onPress={confirmPothole}>
            <Text style={styles.confirmBig}>TAP = POTHOLE</Text>
            <Text style={styles.confirmSub}>
              {pendingConfirm.classification.replace("_", " ")} detected ·
              ignore to decide later
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  const cloudEventCount = cloudDrives.reduce((sum, d) => sum + d.items.length, 0);

  return (
    <View style={[styles.screen, styles.homeScreen]}>
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
        onLogOut={logOut}
      />
      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={styles.homeContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.homeHeader}>
          <Pressable
            style={styles.menuBtn}
            onPress={() => setNavOpen(true)}
            hitSlop={10}
          >
            <Text style={styles.menuBtnText}>☰</Text>
          </Pressable>
          <Text style={styles.homeTitle}>PotholeProof</Text>
          <Text style={styles.homeTagline}>Every commute is a road survey.</Text>
        </View>

        <View style={styles.heroGroup}>
          <Pressable style={styles.primaryBtn} onPress={() => setPhase("navigate")}>
            <Text style={styles.primaryBtnText}>START NAVIGATION</Text>
          </Pressable>
          <Pressable style={styles.demoBtn} onPress={startDrive}>
            <Text style={styles.demoBtnText}>🚧 Survey Roads</Text>
          </Pressable>
          <Pressable style={styles.demoBtn} onPress={startDemoDrive}>
            <Text style={styles.demoBtnText}>▶ Demo drive (simulated)</Text>
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Your data</Text>
          <View style={styles.statRow}>
            <Text style={[styles.statValue, !cloudEventCount && styles.statValueEmpty]}>
              {cloudEventCount}
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
            <Text style={styles.rowBtnText}>📂 Manage saved data</Text>
            <Text style={styles.rowBtnChevron}>›</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.rowBtn}
            onPress={syncAllToCloud}
            disabled={syncingAll}
          >
            <Text style={styles.rowBtnText}>
              {syncingAll ? "Syncing…" : "☁ Sync saved drives to cloud"}
            </Text>
            <Text style={styles.rowBtnChevron}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.homeFooter}>detector {MODEL_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f7f9",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    paddingTop: 72,
  },
  centerFill: { padding: 0, paddingTop: 0 },
  driveScreen: { backgroundColor: "#101317" },
  h1: { fontSize: 32, fontWeight: "800", color: "#1a1d21" },
  backRow: { alignSelf: "flex-start", paddingVertical: 6, marginBottom: 2 },
  backRowText: { color: "#e8442e", fontSize: 15, fontWeight: "600" },
  sub: {
    fontSize: 15,
    color: "#5b6570",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  homeScreen: { justifyContent: "flex-start", alignItems: "stretch", padding: 0 },
  homeScroll: { flex: 1, alignSelf: "stretch" },
  homeContent: { paddingHorizontal: 20, paddingTop: 48, paddingBottom: 40 },
  homeHeader: { marginBottom: 20 },
  menuBtn: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  menuBtnText: { fontSize: 24, color: "#1a1d21" },
  homeTitle: { fontSize: 34, fontWeight: "800", color: "#1a1d21" },
  homeTagline: { fontSize: 15, color: "#5b6570", marginTop: 4 },
  heroGroup: { marginBottom: 24 },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8a939d",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statValue: { fontSize: 26, fontWeight: "800", color: "#2e9e4f" },
  statValueEmpty: { color: "#c3c9d0" },
  statBreakdown: { fontSize: 12, color: "#8a939d", marginTop: 4 },
  statCaption: { flex: 1, fontSize: 13, color: "#5b6570" },
  divider: { height: 1, backgroundColor: "#eef0f2", marginVertical: 4 },
  rowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  rowBtnText: { fontSize: 15, fontWeight: "600", color: "#1a1d21" },
  rowBtnChevron: { fontSize: 20, color: "#c3c9d0" },
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
  homeFooter: { textAlign: "center", color: "#8a939d", fontSize: 12, marginTop: 4 },
  map: {
    alignSelf: "stretch",
    height: 220,
    borderRadius: 12,
    marginVertical: 10,
  },
  primaryBtn: {
    backgroundColor: "#e8442e",
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 999,
    marginTop: 24,
    alignSelf: "stretch",
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  demoBtn: {
    borderWidth: 2,
    borderColor: "#e8442e",
    paddingVertical: 14,
    borderRadius: 999,
    marginTop: 12,
    alignSelf: "stretch",
    alignItems: "center",
  },
  demoBtnText: { color: "#e8442e", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { marginTop: 14, padding: 10 },
  secondaryBtnText: { color: "#e8442e", fontSize: 15, fontWeight: "600" },
  dangerText: { color: "#d92616", fontSize: 15, fontWeight: "700" },
  trashBtn: { padding: 6, marginLeft: 8 },
  trashText: { fontSize: 18 },
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
  confirmBig: { color: "#fff", fontSize: 44, fontWeight: "900" },
  confirmSub: { color: "#fff", opacity: 0.9, marginTop: 10, fontSize: 15 },
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
  demoBadge: {
    position: "absolute",
    top: 64,
    backgroundColor: "#e8812e",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  demoBadgeText: { color: "#fff", fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  driveSpeed: { fontSize: 96, fontWeight: "200", color: "#fff" },
  driveSpeedUnit: { fontSize: 24, color: "#8a939d" },
  driveCount: { fontSize: 64, fontWeight: "800", color: "#e8442e", marginTop: 24 },
  driveStat: { fontSize: 14, color: "#8a939d", marginTop: 4 },
  driveHint: {
    position: "absolute",
    bottom: 28,
    color: "#5b6570",
    fontSize: 13,
    textAlign: "center",
  },
  stopBtn: {
    backgroundColor: "#e8442e",
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 999,
    marginTop: 40,
    alignSelf: "stretch",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
    alignSelf: "stretch",
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#1a1d21" },
  cardMeta: { fontSize: 13, color: "#5b6570", marginTop: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  labelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d5dae0",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  labelYes: { backgroundColor: "#d9f2df", borderColor: "#2e9e4f" },
  labelNo: { backgroundColor: "#fbe3e0", borderColor: "#e8442e" },
  labelText: { fontSize: 15, fontWeight: "600", color: "#1a1d21" },
});
