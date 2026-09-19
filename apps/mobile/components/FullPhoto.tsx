import { useEffect, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View, type StyleProp, type ImageStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii } from "../theme";

interface FullPhotoProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  /** Tallest the thumbnail may be; the whole photo is still shown inside it. */
  maxHeight?: number;
}

/**
 * A photo thumbnail that is never cropped: it keeps its own aspect ratio and is
 * letterboxed inside a height cap, so tall photos don't swallow the screen.
 * Tap it to see the photo large.
 */
export function FullPhoto({ uri, style, maxHeight = 180 }: FullPhotoProps) {
  // 4:3 until the real size is known, so the layout doesn't jump much.
  const [ratio, setRatio] = useState(4 / 3);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setRatio(w / h);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="View photo full size">
        <Image
          source={{ uri }}
          style={[styles.photo, { aspectRatio: ratio, maxHeight }, style]}
          resizeMode="contain"
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" />
          <View style={styles.close}>
            <Ionicons name="close" size={26} color={colors.white} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", borderRadius: radii.sm, backgroundColor: colors.neutral.surfaceAlt },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" },
  full: { width: "100%", height: "100%" },
  close: { position: "absolute", top: 56, right: 20 },
});
