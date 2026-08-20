import { useEffect, useRef } from "react";
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";

const DRAWER_WIDTH = Math.min(300, Dimensions.get("window").width * 0.8);

interface SideNavbarProps {
  visible: boolean;
  onClose: () => void;
  displayName: string | null;
  email: string | null;
  contributedCount: number;
  isAdmin: boolean;
  onNavigate: () => void;
  onContribute: () => void;
  onOpenLibrary: () => void;
  onOpenAdmin: () => void;
  onLogOut: () => void;
}

export default function SideNavbar({
  visible,
  onClose,
  displayName,
  email,
  contributedCount,
  isAdmin,
  onNavigate,
  onContribute,
  onOpenLibrary,
  onOpenAdmin,
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={styles.fill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX: slide }] }]}
        >
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

          <Pressable
            style={styles.navItem}
            onPress={() => {
              onClose();
              onNavigate();
            }}
          >
            <Text style={styles.navIcon}>🧭</Text>
            <Text style={styles.navLabel}>Start Navigation</Text>
          </Pressable>

          <Pressable
            style={styles.navItem}
            onPress={() => {
              onClose();
              onContribute();
            }}
          >
            <Text style={styles.navIcon}>🚧</Text>
            <Text style={styles.navLabel}>Survey Roads</Text>
          </Pressable>

          <Pressable
            style={styles.navItem}
            onPress={() => {
              onClose();
              onOpenLibrary();
            }}
          >
            <Text style={styles.navIcon}>📂</Text>
            <Text style={styles.navLabel}>Saved data</Text>
          </Pressable>

          {isAdmin && (
            <Pressable
              style={styles.navItem}
              onPress={() => {
                onClose();
                onOpenAdmin();
              }}
            >
              <Text style={styles.navIcon}>📊</Text>
              <Text style={styles.navLabel}>Admin dashboard</Text>
            </Pressable>
          )}

          <View style={styles.spacer} />

          <View style={styles.divider} />

          <Pressable
            style={styles.navItem}
            onPress={() => {
              onClose();
              onLogOut();
            }}
          >
            <Text style={styles.navIcon}>🚪</Text>
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16,19,23,0.5)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#fff",
    paddingTop: 64,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 0 },
    elevation: 8,
  },
  profile: { alignItems: "flex-start", marginBottom: 12 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#e8442e",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  name: { fontSize: 18, fontWeight: "800", color: "#1a1d21", alignSelf: "stretch" },
  email: { fontSize: 13, color: "#5b6570", marginTop: 2, alignSelf: "stretch" },
  stat: { fontSize: 12, color: "#8a939d", marginTop: 8 },
  divider: { height: 1, backgroundColor: "#eef0f2", marginVertical: 12 },
  navItem: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 14 },
  navIcon: { fontSize: 20, width: 24, textAlign: "center" },
  navLabel: { fontSize: 16, fontWeight: "600", color: "#1a1d21" },
  logOutText: { color: "#d92616" },
  spacer: { flex: 1 },
});
