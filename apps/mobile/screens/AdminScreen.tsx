import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import MapView, { Marker, type Region } from "react-native-maps";
import { collection, onSnapshot } from "firebase/firestore";
import type { JoltEvent } from "@potholeproof/shared-types";
import { db } from "../firebase";
import { DRIVES_COLLECTION, type CloudDrive, type CloudLabel } from "../cloudDrives";

interface MapEvent {
  key: string;
  event: JoltEvent;
  label: CloudLabel;
  driveId: string;
  uid: string;
  ownerEmail: string | null;
}

/** Same color scheme as the review-screen map for visual consistency. */
function pinColor(e: JoltEvent): string {
  if (e.classification === "pothole") {
    return e.severity >= 0.67 ? "#d92616" : e.severity >= 0.34 ? "#e8812e" : "#e6b91e";
  }
  if (e.classification === "speed_bump") return "#4a72da";
  return "#8a939d";
}

interface AdminScreenProps {
  onClose: () => void;
}

const FALLBACK_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.3,
  longitudeDelta: 0.3,
};

export default function AdminScreen({ onClose }: AdminScreenProps) {
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<MapEvent | null>(null);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") {
          setInitialRegion(FALLBACK_REGION);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        setInitialRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        });
      } catch {
        setInitialRegion(FALLBACK_REGION);
      }
    })();
  }, []);

  useEffect(() => {
    const unsubDrives = onSnapshot(collection(db, DRIVES_COLLECTION), (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CloudDrive, "id">) })));
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const map: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as { email?: string };
        if (data.email) map[d.id] = data.email;
      });
      setUserEmails(map);
    });
    return () => {
      unsubDrives();
      unsubUsers();
    };
  }, []);

  const points = useMemo<MapEvent[]>(() => {
    const out: MapEvent[] = [];
    for (const drive of drives) {
      for (const item of drive.items ?? []) {
        out.push({
          key: `${drive.id}:${item.event.id}`,
          event: item.event,
          label: item.label,
          driveId: drive.driveId,
          uid: drive.uid,
          ownerEmail: userEmails[drive.uid] ?? null,
        });
      }
    }
    return out;
  }, [drives, userEmails]);

  const metrics = useMemo(() => {
    const distinctDrivers = new Set(drives.map((d) => d.uid)).size;
    const confirmedPotholes = points.filter((p) => p.label === "pothole").length;
    const byClass = points.reduce<Record<string, number>>((acc, p) => {
      acc[p.event.classification] = (acc[p.event.classification] ?? 0) + 1;
      return acc;
    }, {});
    const approxKb = drives.reduce((sum, d) => sum + JSON.stringify(d).length, 0) / 1024;
    const latestMs = drives.reduce(
      (max, d) => Math.max(max, d.updatedAt?.toMillis?.() ?? 0),
      0
    );

    return [
      { label: "Drives", value: String(drives.length) },
      { label: "Events", value: String(points.length) },
      { label: "Potholes", value: String(confirmedPotholes) },
      { label: "Speed bumps", value: String(byClass.speed_bump ?? 0) },
      { label: "Drivers", value: String(distinctDrivers) },
      {
        label: "Data size",
        value:
          approxKb > 1024 ? `${(approxKb / 1024).toFixed(1)} MB` : `${approxKb.toFixed(0)} KB`,
      },
      { label: "Last active", value: latestMs > 0 ? new Date(latestMs).toLocaleDateString() : "—" },
    ];
  }, [drives, points]);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Admin dashboard</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.metricsScroll}
        contentContainerStyle={styles.metricsRow}
      >
        {metrics.map((m) => (
          <View key={m.label} style={styles.metricCard}>
            <Text style={styles.metricLabel} numberOfLines={1}>
              {m.label}
            </Text>
            <Text style={styles.metricValue} numberOfLines={1}>
              {m.value}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.mapWrap}>
        {initialRegion ? (
          <MapView style={styles.map} initialRegion={initialRegion} showsUserLocation>
            {points.map((p) => (
              <Marker
                key={p.key}
                coordinate={{ latitude: p.event.location.lat, longitude: p.event.location.lng }}
                pinColor={pinColor(p.event)}
                onPress={() => setSelected(p)}
              />
            ))}
          </MapView>
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color="#e8442e" />
          </View>
        )}
      </View>

      {selected && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeaderRow}>
            <Text style={styles.detailTitle}>
              {selected.event.classification.replace("_", " ")}
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={10}>
              <Text style={styles.detailClose}>×</Text>
            </Pressable>
          </View>
          <DetailRow
            label="Label"
            value={selected.label === "pothole" ? "Confirmed pothole" : "Not a pothole"}
          />
          <DetailRow label="Severity" value={`${Math.round(selected.event.severity * 100)}%`} />
          <DetailRow label="Confidence" value={`${Math.round(selected.event.confidence * 100)}%`} />
          <DetailRow label="Speed" value={`${(selected.event.speedMps * 2.237).toFixed(0)} mph`} />
          <DetailRow label="Captured" value={new Date(selected.event.capturedAt).toLocaleString()} />
          <DetailRow label="Drive" value={selected.driveId} />
          <DetailRow label="Driver" value={selected.ownerEmail ?? selected.uid} />
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f7f9", paddingTop: 52 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 8 },
  backText: { color: "#e8442e", fontSize: 15, fontWeight: "600", marginRight: 14 },
  title: { fontSize: 18, fontWeight: "800", color: "#1a1d21" },
  metricsScroll: { flexGrow: 0, height: 46, marginBottom: 8 },
  metricsRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  metricCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 10,
    width: 118,
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#8a939d",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  metricValue: { fontSize: 15, fontWeight: "800", color: "#1a1d21", marginTop: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  detailCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitle: { fontSize: 17, fontWeight: "800", color: "#1a1d21", textTransform: "capitalize" },
  detailClose: { fontSize: 22, color: "#8a939d" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#eef0f2",
  },
  detailLabel: { fontSize: 13, color: "#8a939d" },
  detailValue: { fontSize: 13, fontWeight: "600", color: "#1a1d21" },
});
