import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { CivicHazardKind } from "@potholeproof/civic";
import { Button, Card } from "./ui";
import { FullPhoto } from "./FullPhoto";
import { colors, fontFamily, radii, space } from "../theme";

/** A photo goes into the report doc itself (no Storage bucket in the pilot), so
 *  it is downscaled first: a phone photo is 12+ megapixels, far too big for a
 *  Firestore doc (1 MB limit) and far more than a city ticket needs. */
const PHOTO_MAX_WIDTH = 1280;
const PHOTO_JPEG_QUALITY = 0.75;
/** Safety net after downscaling: the base64 must stay under this many chars. */
const MAX_PHOTO_BASE64_CHARS = 700_000;
const NOTES_MAX = 300;

interface CivicReportSheetProps {
  visible: boolean;
  kind: CivicHazardKind;
  /** undefined while the street address is still being looked up. */
  address: string | null | undefined;
  confirmers: number;
  days: number;
  submitting: boolean;
  /** "edit" reopens the sheet on an already-filed report (notes + photo only). */
  mode?: "file" | "edit";
  initialNotes?: string;
  initialPhoto?: string | null;
  onClose: () => void;
  onSubmit: (notes: string, photoDataUri: string | null) => void;
}

export function CivicReportSheet({
  visible,
  kind,
  address,
  confirmers,
  days,
  submitting,
  mode = "file",
  initialNotes = "",
  initialPhoto = null,
  onClose,
  onSubmit,
}: CivicReportSheetProps) {
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNotes(initialNotes);
      setPhoto(initialPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function pick(source: "camera" | "library") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access in Settings to attach a photo.");
          return;
        }
      }
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset) return;

      // Resize (only if wider than the target) and re-encode as a modest JPEG.
      let ctx = ImageManipulator.manipulate(asset.uri);
      if (asset.width > PHOTO_MAX_WIDTH) ctx = ctx.resize({ width: PHOTO_MAX_WIDTH });
      const image = await ctx.renderAsync();
      const out = await image.saveAsync({ compress: PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
      const b64 = out.base64;
      if (!b64) throw new Error("no base64 output");
      if (b64.length > MAX_PHOTO_BASE64_CHARS) {
        Alert.alert("Photo too large", "Try a closer or simpler photo.");
        return;
      }
      setPhoto(`data:image/jpeg;base64,${b64}`);
    } catch {
      Alert.alert("Couldn't attach the photo", "Please try again.");
    }
  }

  function addPhoto() {
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => void pick("camera") },
      { text: "Choose from library", onPress: () => void pick("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Card style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{mode === "edit" ? "Edit your report" : "Report to the city"}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.neutral.inkSoft} />
              </Pressable>
            </View>

            <View style={styles.summary}>
              <Text style={styles.summaryKind}>{kind === "rough_road" ? "Severely rough road" : "Pothole"}</Text>
              {address === undefined ? (
                <View style={styles.addressRow}>
                  <ActivityIndicator size="small" color={colors.brand.primary} />
                  <Text style={styles.summaryMeta}>Finding the street address…</Text>
                </View>
              ) : (
                <Text style={styles.summaryMeta}>{address ?? "Address unavailable — sending coordinates"}</Text>
              )}
              <Text style={styles.summaryMeta}>
                Confirmed by {confirmers} driver{confirmers === 1 ? "" : "s"}
                {days > 1 ? ` over ${days} days` : ""}
              </Text>
            </View>

            <Text style={styles.label}>Notes for the city (optional)</Text>
            <TextInput
              style={styles.input}
              value={notes}
              onChangeText={(t) => setNotes(t.slice(0, NOTES_MAX))}
              placeholder="e.g. Deep hole in the right lane, near the bus stop"
              placeholderTextColor={colors.neutral.inkFaint}
              multiline
            />

            <Text style={[styles.label, styles.labelSpaced]}>Photo (optional)</Text>
            {photo ? (
              <View>
                <FullPhoto uri={photo} maxHeight={140} style={{ marginTop: space.sm }} />
                <Pressable onPress={() => setPhoto(null)} hitSlop={8} style={styles.removePhoto}>
                  <Text style={styles.removePhotoText}>Remove photo</Text>
                </Pressable>
              </View>
            ) : (
              <Button label="Add a photo" onPress={addPhoto} variant="outline" size="sm" icon="camera-outline" />
            )}

            <Button
              label={mode === "edit" ? "Save changes" : "Submit to city"}
              onPress={() => onSubmit(notes, photo)}
              loading={submitting}
              disabled={address === undefined}
              variant="primary"
              size="lg"
              icon="megaphone-outline"
              style={styles.submitBtn}
            />
            <Text style={styles.footnote}>
              {mode === "edit"
                ? "The city sees your updated note and photo. You can edit until the report is complete or rejected."
                : "It will show as “Pending city review” until the city responds. You and the drivers who confirmed it will be notified as it moves."}
            </Text>
          </ScrollView>
        </Card>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16,19,23,0.5)" },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: "88%", paddingBottom: space.xl },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md },
  title: { fontFamily: fontFamily.display, fontSize: 20, color: colors.neutral.ink },
  summary: {
    backgroundColor: colors.neutral.surfaceAlt,
    borderRadius: radii.sm,
    padding: space.md,
    marginBottom: space.lg,
    gap: 4,
  },
  summaryKind: { fontFamily: fontFamily.bodyBold, fontSize: 15, color: colors.neutral.ink },
  summaryMeta: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft },
  addressRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { fontFamily: fontFamily.bodyBold, fontSize: 13, color: colors.neutral.inkSoft },
  labelSpaced: { marginTop: space.lg },
  input: {
    marginTop: space.sm,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    borderRadius: radii.sm,
    padding: space.md,
    fontFamily: fontFamily.body,
    fontSize: 14,
    color: colors.neutral.ink,
    textAlignVertical: "top",
  },
  removePhoto: { alignSelf: "flex-start", marginTop: space.sm },
  removePhotoText: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.status.danger },
  submitBtn: { marginTop: space.xl },
  footnote: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    color: colors.neutral.inkFaint,
    marginTop: space.md,
    lineHeight: 17,
  },
});
