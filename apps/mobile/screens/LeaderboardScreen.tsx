import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { DRIVES_COLLECTION, type CloudDrive } from "../cloudDrives";
import { HAZARD_CONTRIBUTIONS_COLLECTION } from "../hazardReports";
import { Card, EmptyState, ScreenHeader, SegmentedControl } from "../components/ui";
import { colors, fontFamily, space } from "../theme";

interface LeaderboardScreenProps {
  onClose: () => void;
}

type Board = "contributions" | "potholes";

const BOARD_OPTIONS: { value: Board; label: string }[] = [
  { value: "contributions", label: "Hazards reported" },
  { value: "potholes", label: "Potholes confirmed" },
];

interface Row {
  uid: string;
  name: string;
  count: number;
}

export default function LeaderboardScreen({ onClose }: LeaderboardScreenProps) {
  const [board, setBoard] = useState<Board>("contributions");
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [contributions, setContributions] = useState<{ hazardId: string; uid: string }[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubDrives = onSnapshot(collection(db, DRIVES_COLLECTION), (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CloudDrive, "id">) })));
      setLoaded(true);
    });
    const unsubContributions = onSnapshot(collection(db, HAZARD_CONTRIBUTIONS_COLLECTION), (snap) => {
      setContributions(snap.docs.map((d) => d.data() as { hazardId: string; uid: string }));
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const map: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as { email?: string; displayName?: string };
        if (data.displayName || data.email) map[d.id] = data.displayName || data.email!;
      });
      setUserNames(map);
    });
    return () => {
      unsubDrives();
      unsubContributions();
      unsubUsers();
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const counts = new Map<string, number>();
    if (board === "contributions") {
      const seen = new Set<string>(); // dedupe per (uid, hazardId)
      for (const c of contributions) {
        const key = `${c.uid}:${c.hazardId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(c.uid, (counts.get(c.uid) ?? 0) + 1);
      }
    } else {
      for (const drive of drives) {
        for (const item of drive.items ?? []) {
          if (item.label !== "pothole") continue;
          counts.set(drive.uid, (counts.get(drive.uid) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .map(([uid, count]) => ({ uid, count, name: userNames[uid] ?? "Driver" }))
      .sort((a, b) => b.count - a.count);
  }, [board, drives, contributions, userNames]);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="Leaderboard" onBack={onClose} />
        <SegmentedControl options={BOARD_OPTIONS} value={board} onChange={setBoard} />
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(r) => r.uid}
        ListEmptyComponent={
          loaded ? (
            <EmptyState
              icon="trophy-outline"
              title="No rankings yet"
              message="Report a hazard or confirm a pothole to climb the board."
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <Card style={styles.row}>
            <Text style={[styles.rank, index < 3 && styles.rankTop]}>{index + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.count}>{item.count}</Text>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56 },
  headerWrap: { paddingHorizontal: space.lg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", marginBottom: space.sm, paddingVertical: space.md },
  rank: {
    width: 28,
    fontFamily: fontFamily.mono,
    fontSize: 15,
    color: colors.neutral.inkFaint,
  },
  rankTop: { color: colors.brand.primary },
  name: { flex: 1, fontFamily: fontFamily.bodySemibold, fontSize: 15, color: colors.neutral.ink },
  count: { fontFamily: fontFamily.mono, fontSize: 18, color: colors.neutral.ink },
});
