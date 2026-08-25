import { FlatList, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { AppNotification } from "../notifications";
import { Card, EmptyState, ScreenHeader } from "../components/ui";
import { colors, fontFamily, space } from "../theme";

interface NotificationsScreenProps {
  notifications: AppNotification[];
  onClose: () => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen({ notifications, onClose }: NotificationsScreenProps) {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="Notifications" onBack={onClose} />
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={notifications}
        keyExtractor={(n) => n.id}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-outline"
            title="Nothing yet"
            message="Updates about your reports — like when the city confirms a fix — will show up here."
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.row}>
            {!item.read && <View style={styles.unreadDot} />}
            <View style={styles.iconWrap}>
              <Ionicons name="checkmark-done-outline" size={18} color={colors.status.success} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
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
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, marginBottom: space.sm },
  unreadDot: {
    position: "absolute",
    top: space.lg,
    left: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand.primary,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.status.successTint,
  },
  textCol: { flex: 1 },
  title: { fontFamily: fontFamily.bodyBold, fontSize: 15, color: colors.neutral.ink },
  body: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft, marginTop: 2, lineHeight: 18 },
  time: { fontFamily: fontFamily.bodyMedium, fontSize: 11, color: colors.neutral.inkFaint, marginTop: 6 },
});
