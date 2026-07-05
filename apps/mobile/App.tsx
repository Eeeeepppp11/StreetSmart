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
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { DetectionPipeline } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import type { JoltEvent, SensorSample, Vec3 } from "@potholeproof/shared-types";

const G = 9.81; // expo-sensors accelerometer reports g-force incl. gravity
const SENSOR_INTERVAL_MS = 20; // request ~50 Hz
const DRAIN_INTERVAL_MS = 300;
const STORAGE_KEY = "pp.labeled.v1";
const SERVER_KEY = "pp.server.url";
const ANON_KEY = "pp.anon.id";
const MODEL_VERSION = "heuristic-v0-expo";
const APP_VERSION = "0.1.0";

type Label = "pothole" | "not_pothole";
interface LabeledEvent {
  event: JoltEvent;
  label: Label;
}

type Phase = "idle" | "driving" | "review";

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<JoltEvent[]>([]);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [speedMps, setSpeedMps] = useState(0);
  const [sampleHz, setSampleHz] = useState(0);
  const [gpsOk, setGpsOk] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SERVER_KEY).then((v) => v && setServerUrl(v));
    AsyncStorage.getItem(STORAGE_KEY).then(
      (raw) => raw && setSavedCount((JSON.parse(raw) as unknown[]).length)
    );
  }, []);

  const pipeline = useRef<DetectionPipeline | null>(null);
  const buffer = useRef<SensorSample[]>([]);
  const lastGyro = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const seq = useRef(0);
  const subs = useRef<{ remove: () => void }[]>([]);
  const drainTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startDrive() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Location needed",
        "Without location, detected potholes can't be placed on the map."
      );
      return;
    }

    pipeline.current = new DetectionPipeline({
      nextId: () => `evt-${Date.now()}-${++seq.current}`,
      modelVersion: MODEL_VERSION,
    });
    buffer.current = [];
    setEvents([]);
    setLabels({});
    setGpsOk(false);
    setSampleHz(0);

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
            location: {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
            },
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

  function stopDrive() {
    if (drainTimer.current) clearInterval(drainTimer.current);
    drainTimer.current = null;
    for (const s of subs.current) s.remove();
    subs.current = [];
    const tail = pipeline.current?.flush() ?? [];
    if (tail.length > 0) setEvents((prev) => [...prev, ...tail]);
    pipeline.current = null;
    setPhase("review");
  }

  function setLabel(id: string, label: Label) {
    setLabels((prev) => ({ ...prev, [id]: label }));
  }

  async function saveLabels() {
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
    const events = [...byId.values()].map((l) => l.event);
    const labels = Object.fromEntries(
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
          events,
          labels,
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
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <Text style={styles.h1}>Review drive</Text>
        <Text style={styles.sub}>
          {events.length} detection{events.length === 1 ? "" : "s"} · confirm
          each one to build training data
        </Text>
        <FlatList
          style={{ flex: 1, alignSelf: "stretch" }}
          data={events}
          keyExtractor={(e) => e.id}
          ListEmptyComponent={
            <Text style={styles.sub}>
              No jolts detected this drive. Smooth roads!
            </Text>
          }
          renderItem={({ item }) => {
            const label = labels[item.id];
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {item.classification.replace("_", " ")} ·{" "}
                  {Math.round(item.severity * 100)}% severity
                </Text>
                <Text style={styles.cardMeta}>
                  {new Date(item.capturedAt).toLocaleTimeString()} ·{" "}
                  {(item.speedMps * 2.237).toFixed(0)} mph ·{" "}
                  {Math.round(item.confidence * 100)}% confidence
                </Text>
                <View style={styles.row}>
                  <Pressable
                    onPress={() => setLabel(item.id, "pothole")}
                    style={[
                      styles.labelBtn,
                      label === "pothole" && styles.labelYes,
                    ]}
                  >
                    <Text style={styles.labelText}>✓ Pothole</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setLabel(item.id, "not_pothole")}
                    style={[
                      styles.labelBtn,
                      label === "not_pothole" && styles.labelNo,
                    ]}
                  >
                    <Text style={styles.labelText}>✗ Not</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
        <Pressable style={styles.primaryBtn} onPress={saveLabels}>
          <Text style={styles.primaryBtnText}>
            {pending > 0 ? `Save (${pending} unlabeled skipped)` : "Save labels"}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "driving") {
    return (
      <View style={[styles.screen, styles.driveScreen]}>
        <StatusBar style="light" />
        <Text style={styles.driveSpeed}>
          {(speedMps * 2.237).toFixed(0)}
          <Text style={styles.driveSpeedUnit}> mph</Text>
        </Text>
        <Text style={styles.driveStat}>
          sensors {sampleHz} Hz · GPS {gpsOk ? "✓" : "…"}
        </Text>
        <Text style={styles.driveCount}>{events.length}</Text>
        <Text style={styles.driveStat}>jolts this drive</Text>
        <Pressable style={styles.stopBtn} onPress={stopDrive}>
          <Text style={styles.primaryBtnText}>END DRIVE</Text>
        </Pressable>
        <Text style={styles.driveHint}>
          Mount the phone, keep the app open, and drive normally.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.h1}>PotholeProof</Text>
      <Text style={styles.sub}>
        Phase-1 pilot — detect, log, and label road damage as you drive.
      </Text>
      {savedCount !== null && (
        <Text style={styles.sub}>💾 {savedCount} labeled events stored</Text>
      )}
      <Pressable style={styles.primaryBtn} onPress={startDrive}>
        <Text style={styles.primaryBtnText}>START DRIVE</Text>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={exportTrainingData}>
        <Text style={styles.secondaryBtnText}>Export training data</Text>
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
      <Pressable
        style={styles.secondaryBtn}
        onPress={uploadToServer}
        disabled={uploading}
      >
        <Text style={styles.secondaryBtnText}>
          {uploading ? "Uploading…" : "Upload to server"}
        </Text>
      </Pressable>
      <Text style={styles.footer}>
        detector {MODEL_VERSION} · every commute is a road survey
      </Text>
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
  secondaryBtn: { marginTop: 16, padding: 12 },
  secondaryBtnText: { color: "#e8442e", fontSize: 15, fontWeight: "600" },
  urlInput: {
    alignSelf: "stretch",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d5dae0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 20,
    fontSize: 14,
    color: "#1a1d21",
  },
  footer: { position: "absolute", bottom: 28, color: "#8a939d", fontSize: 12 },
  driveSpeed: { fontSize: 96, fontWeight: "200", color: "#fff" },
  driveSpeedUnit: { fontSize: 24, color: "#8a939d" },
  driveCount: {
    fontSize: 64,
    fontWeight: "800",
    color: "#e8442e",
    marginTop: 24,
  },
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
