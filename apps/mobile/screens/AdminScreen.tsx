import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { Badge, EmptyState, IconButton, ScreenHeader } from "../components/ui";
import { classify, colors, fontFamily, radii, space } from "../theme";

interface MapEvent {
  key: string;
  event: JoltEvent;
  label: CloudLabel;
  driveId: string;
  uid: string;
  ownerEmail: string | null;
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
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
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

  const noDrivesYet = loaded && drives.length === 0;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="Admin dashboard" onBack={onClose} />
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
                pinColor={classify(p.event).color}
                onPress={() => setSelected(p)}
              />
            ))}
          </MapView>
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.brand.primary} />
          </View>
        )}
        {noDrivesYet && (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <EmptyState
              icon="cloud-offline-outline"
              title="No drives yet"
              message="Once drivers start contributing, their trips will appear here."
            />
          </View>
        )}
      </View>

      {selected && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeaderRow}>
            <Text style={styles.detailTitle}>
              {selected.event.classification.replace("_", " ")}
            </Text>
            <IconButton icon="close" onPress={() => setSelected(null)} accessibilityLabel="Close detail" />
          </View>
          <View style={styles.aiBadgeRow}>
            <Badge label={selected.event.modelVersion} icon="hardware-chip-outline" tone="neutral" />
          </View>
          <DetailRow
            label="Label"
            value={selected.label === "pothole" ? "Confirmed pothole" : "Not a pothole"}
          />
          <DetailRow label="Severity" value={`${Math.round(selected.event.severity * 100)}%`} numeric />
          <DetailRow label="AI confidence" value={`${Math.round(selected.event.confidence * 100)}%`} numeric />
          <DetailRow label="Speed" value={`${(selected.event.speedMps * 2.237).toFixed(0)} mph`} numeric />
          <DetailRow label="Captured" value={new Date(selected.event.capturedAt).toLocaleString()} />
          <DetailRow label="Drive" value={selected.driveId} />
          <DetailRow label="Driver" value={selected.ownerEmail ?? selected.uid} />
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, numeric && styles.detailValueNumeric]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 52 },
  headerWrap: { paddingHorizontal: space.lg },
  metricsScroll: { flexGrow: 0, height: 46, marginBottom: space.sm },
  metricsRow: { paddingHorizontal: space.lg, gap: space.sm, alignItems: "center" },
  metricCard: {
    backgroundColor: colors.neutral.surface,
    borderRadius: radii.sm,
    paddingVertical: 5,
    paddingHorizontal: space.md,
    width: 118,
    shadowColor: colors.neutral.ink,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  metricLabel: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 9,
    color: colors.neutral.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  metricValue: { fontFamily: fontFamily.mono, fontSize: 15, color: colors.neutral.ink, marginTop: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  detailCard: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: space.xxl,
    backgroundColor: colors.neutral.surface,
    borderRadius: radii.lg,
    padding: space.lg,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitle: { fontFamily: fontFamily.bodyBold, fontSize: 17, color: colors.neutral.ink, textTransform: "capitalize" },
  aiBadgeRow: { marginTop: 4, marginBottom: 4 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral.divider,
  },
  detailLabel: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkFaint },
  detailValue: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.neutral.ink },
  detailValueNumeric: { fontFamily: fontFamily.monoMedium },
});
