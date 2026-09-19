import { useEffect, useRef } from "react";
import { Animated, Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontFamily, radii, space } from "../theme";

const DRAWER_WIDTH = Math.min(300, Dimensions.get("window").width * 0.8);

interface NavItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface SideNavbarProps {
  visible: boolean;
  onClose: () => void;
  displayName: string | null;
  email: string | null;
  contributedCount: number;
  isAdmin: boolean;
  unreadNotifications: number;
  onNavigate: () => void;
  onContribute: () => void;
  onOpenLibrary: () => void;
  onOpenAdmin: () => void;
  onOpenModelInfo: () => void;
  onOpenLeaderboard: () => void;
  onOpenMyReports: () => void;
  onOpenCityReview: () => void;
  onOpenNotifications: () => void;
  onLogOut: () => void;
}

export default function SideNavbar({
  visible,
  onClose,
  displayName,
  email,
  contributedCount,
  isAdmin,
  unreadNotifications,
  onNavigate,
  onContribute,
  onOpenLibrary,
  onOpenAdmin,
  onOpenModelInfo,
  onOpenLeaderboard,
  onOpenMyReports,
  onOpenCityReview,
  onOpenNotifications,
  onLogOut,
}: SideNavbarProps) {
  const slide = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : -DRAWER_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: visible ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slide, fade]);

  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();

  const items: NavItem[] = [
    { icon: "navigate-outline", label: "Start Navigation", onPress: onNavigate },
    { icon: "construct-outline", label: "Survey Roads", onPress: onContribute },
    { icon: "folder-outline", label: "Saved data", onPress: onOpenLibrary },
    { icon: "hardware-chip-outline", label: "How the AI works", onPress: onOpenModelInfo },
    { icon: "trophy-outline", label: "Leaderboard", onPress: onOpenLeaderboard },
    { icon: "document-text-outline", label: "My reports", onPress: onOpenMyReports },
    ...(isAdmin
      ? [
          { icon: "stats-chart-outline" as const, label: "Admin dashboard", onPress: onOpenAdmin },
          { icon: "business-outline" as const, label: "City review", onPress: onOpenCityReview },
        ]
      : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={styles.fill} onPress={onClose} />
        </Animated.View>

        <Animated.View style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX: slide }] }]}>
          <View style={styles.brandRow}>
            <View style={styles.brandLeft}>
              <Image source={require("../assets/brand/mark.png")} style={styles.brandMark} resizeMode="cover" />
              <Text style={styles.brandWordmark}>StreetSmart</Text>
            </View>
            <Pressable
              onPress={() => {
                onClose();
                onOpenNotifications();
              }}
              hitSlop={10}
              style={styles.bellWrap}
              accessibilityRole="button"
              accessibilityLabel={
                unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : "Notifications"
              }
            >
              <Ionicons name="notifications-outline" size={22} color={colors.neutral.ink} />
              {unreadNotifications > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadNotifications > 9 ? "9+" : unreadNotifications}</Text>
                </View>
              )}
            </Pressable>
          </View>

          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {displayName || "Driver"}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {email}
            </Text>
            <Text style={styles.stat}>
              {contributedCount} labeled event{contributedCount === 1 ? "" : "s"} contributed
            </Text>
          </View>

          <View style={styles.divider} />

          {items.map((item) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
              onPress={() => {
                onClose();
                item.onPress();
              }}
            >
              <Ionicons name={item.icon} size={20} color={colors.neutral.ink} style={styles.navIcon} />
              <Text style={styles.navLabel}>{item.label}</Text>
            </Pressable>
          ))}

          <View style={styles.spacer} />

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
            onPress={() => {
              onClose();
              onLogOut();
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.status.danger} style={styles.navIcon} />
            <Text style={[styles.navLabel, styles.logOutText]}>Log out</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(16,19,23,0.5)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.neutral.surface,
    paddingTop: 64,
    paddingHorizontal: space.xl,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 0 },
    elevation: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xl,
  },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: space.sm },
  brandMark: { width: 28, height: 28, borderRadius: radii.sm, overflow: "hidden" },
  brandWordmark: { fontFamily: fontFamily.display, fontSize: 17, color: colors.neutral.ink },
  bellWrap: { padding: 4 },
  bellBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.status.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.neutral.surface,
  },
  bellBadgeText: { color: colors.white, fontSize: 9, fontFamily: fontFamily.bodySemibold },
  profile: { alignItems: "flex-start", marginBottom: space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  avatarText: { color: colors.white, fontSize: 24, fontFamily: fontFamily.display },
  name: { fontSize: 18, fontFamily: fontFamily.display, color: colors.neutral.ink, alignSelf: "stretch" },
  email: { fontSize: 13, color: colors.neutral.inkSoft, marginTop: 2, alignSelf: "stretch", fontFamily: fontFamily.body },
  stat: { fontSize: 12, color: colors.neutral.inkFaint, marginTop: space.sm, fontFamily: fontFamily.bodyMedium },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.neutral.divider, marginVertical: space.md },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radii.sm,
    gap: 14,
  },
  navItemPressed: { backgroundColor: colors.neutral.surfaceAlt },
  navIcon: { width: 22, textAlign: "center" },
  navLabel: { fontSize: 16, fontFamily: fontFamily.bodySemibold, color: colors.neutral.ink },
  logOutText: { color: colors.status.danger },
  spacer: { flex: 1 },
});
