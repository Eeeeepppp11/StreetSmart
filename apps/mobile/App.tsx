import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { DetectionPipeline, makeSamples } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import type { JoltEvent, SensorSample, Vec3 } from "@potholeproof/shared-types";

const G = 9.81; // expo-sensors accelerometer reports g-force incl. gravity
const SENSOR_INTERVAL_MS = 20; // request ~50 Hz
const DRAIN_INTERVAL_MS = 300;
const STORAGE_KEY = "pp.labeled.v1";
const SERVER_KEY = "pp.server.url";
const ANON_KEY = "pp.anon.id";
const MODEL_VERSION = "heuristic-v0-expo";
const APP_VERSION = "0.2.0";

type Label = "pothole" | "not_pothole";
interface LabeledEvent {
  event: JoltEvent;
  label: Label;
}

type Phase = "idle" | "driving" | "review" | "library";

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

  const pipeline = useRef<DetectionPipeline | null>(null);
  const buffer = useRef<SensorSample[]>([]);
  const lastGyro = useRef<Vec3>({ x: 0, y: 0, z: 0 });
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
    AsyncStorage.getItem(STORAGE_KEY).then(
      (raw) => raw && setSavedCount((JSON.parse(raw) as unknown[]).length)
    );
  }, []);

  function freshPipeline() {
    pipeline.current = new DetectionPipeline({
      nextId: () => `evt-${Date.now()}-${++seq.current}`,
      modelVersion: MODEL_VERSION,
    });
    buffer.current = [];
    setEvents([]);
    setLabels({});
    setSampleHz(0);
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
      .map((e) => ({ event: e, label: labels[e.id]! }));
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing: LabeledEvent[] = raw ? JSON.parse(raw) : [];
    const merged = [...existing, ...labeled];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    setSavedCount(merged.length);
    setEvents([]);
    setLabels({});
    setPhase("idle");
  }

  async function exportTrainingData() {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw || raw === "[]") {
      Alert.alert("Nothing yet", "Label some drives first.");
      return;
    }
    await Share.share({ message: raw, title: "PotholeProof training data" });
  }

  async function openLibrary() {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setLibrary(raw ? (JSON.parse(raw) as LabeledEvent[]) : []);
    setPhase("library");
  }

  async function persistLibrary(next: LabeledEvent[]) {
    setLibrary(next);
    setSavedCount(next.length);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function deleteSaved(id: string) {
    void persistLibrary(library.filter((l) => l.event.id !== id));
  }

  function clearSaved() {
    Alert.alert(
      "Delete all saved data?",
      "Removes every labeled event stored on this phone. (Anything already uploaded stays on the server.)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => void persistLibrary([]),
        },
      ]
    );
  }

  async function uploadToServer() {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
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
    const lats = events.map((e) => e.location.lat);
    const lngs = events.map((e) => e.location.lng);
    const region =
      events.length > 0
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
        <Text style={styles.h1}>
          {isDemo ? "Demo results" : "Review drive"}
        </Text>
        <Text style={styles.sub}>
          {events.length} detection{events.length === 1 ? "" : "s"}
          {isDemo
            ? " · simulated — nothing will be saved"
            : " · confirm each one to build training data"}
        </Text>
        {region && (
          <MapView style={styles.map} initialRegion={region}>
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
                  <Text style={styles.cardTitle}>
                    {item.classification.replace("_", " ")} ·{" "}
                    {Math.round(item.severity * 100)}%
                  </Text>
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
        <Pressable style={styles.primaryBtn} onPress={saveLabels}>
          <Text style={styles.primaryBtnText}>
            {isDemo
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
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <Text style={styles.h1}>Saved data</Text>
        <Text style={styles.sub}>
          {library.length} labeled event{library.length === 1 ? "" : "s"} on
          this phone
        </Text>
        <FlatList
          style={{ flex: 1, alignSelf: "stretch" }}
          data={library}
          keyExtractor={(l) => l.event.id}
          ListEmptyComponent={<Text style={styles.sub}>Nothing saved yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View
                  style={[styles.dot, { backgroundColor: pinColor(item.event) }]}
                />
                <Text style={[styles.cardTitle, { flex: 1 }]}>
                  {item.event.classification.replace("_", " ")} ·{" "}
                  {Math.round(item.event.severity * 100)}%
                </Text>
                <Pressable
                  onPress={() => deleteSaved(item.event.id)}
                  style={styles.trashBtn}
                  hitSlop={8}
                >
                  <Text style={styles.trashText}>🗑</Text>
                </Pressable>
              </View>
              <Text style={styles.cardMeta}>
                {new Date(item.event.capturedAt).toLocaleString()} · you said:{" "}
                {item.label === "pothole" ? "✓ pothole" : "✗ not a pothole"}
              </Text>
            </View>
          )}
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
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.h1}>PotholeProof</Text>
      <Text style={styles.sub}>Every commute is a road survey.</Text>
      {savedCount !== null && (
        <Text style={styles.statLine}>💾 {savedCount} labeled events stored</Text>
      )}
      <Pressable style={styles.primaryBtn} onPress={startDrive}>
        <Text style={styles.primaryBtnText}>START DRIVE</Text>
      </Pressable>
      <Pressable style={styles.demoBtn} onPress={startDemoDrive}>
        <Text style={styles.demoBtnText}>▶ Demo drive (simulated)</Text>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={exportTrainingData}>
        <Text style={styles.secondaryBtnText}>Export training data</Text>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={openLibrary}>
        <Text style={styles.secondaryBtnText}>Manage saved data</Text>
      </Pressable>
      <TextInput
        style={styles.urlInput}
        placeholder="server URL, e.g. http://192.168.1.20:4477"
        placeholderTextColor="#9aa3ad"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={serverUrl}
        onChangeText={setServerUrl}
      />
      <Pressable style={styles.secondaryBtn} onPress={uploadToServer} disabled={uploading}>
        <Text style={styles.secondaryBtnText}>
          {uploading ? "Uploading…" : "Upload to server"}
        </Text>
      </Pressable>
      <Text style={styles.footer}>detector {MODEL_VERSION}</Text>
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
  driveScreen: { backgroundColor: "#101317" },
  h1: { fontSize: 32, fontWeight: "800", color: "#1a1d21" },
  sub: {
    fontSize: 15,
    color: "#5b6570",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  statLine: { fontSize: 14, color: "#2e9e4f", marginTop: 4 },
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
  urlInput: {
    alignSelf: "stretch",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d5dae0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 18,
    fontSize: 14,
    color: "#1a1d21",
  },
  footer: { position: "absolute", bottom: 28, color: "#8a939d", fontSize: 12 },
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
