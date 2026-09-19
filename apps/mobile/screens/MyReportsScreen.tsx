import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Alert } from "react-native";
import { isOpenStatus } from "@potholeproof/civic";
import { editCivicReport, subscribeToRelevantCivicReports, type CivicReportDoc } from "../civicMock";
import { CivicReportCard } from "../components/CivicReportCard";
import { CivicReportSheet } from "../components/CivicReportSheet";
import { Button, EmptyState, ScreenHeader } from "../components/ui";
import { colors, fontFamily, space } from "../theme";

interface MyReportsScreenProps {
  uid: string;
  onClose: () => void;
}

function newestFirst(a: CivicReportDoc, b: CivicReportDoc): number {
  return Date.parse(b.submittedAt) - Date.parse(a.submittedAt);
}

/** Reports you filed with the city, and reports on hazards you helped confirm. */
export default function MyReportsScreen({ uid, onClose }: MyReportsScreenProps) {
  const [mine, setMine] = useState<CivicReportDoc[]>([]);
  const [confirmed, setConfirmed] = useState<CivicReportDoc[]>([]);
  const [editing, setEditing] = useState<CivicReportDoc | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveEdit(notes: string, photo: string | null) {
    if (!editing) return;
    setSaving(true);
    try {
      await editCivicReport(editing, { notes, photoDataUri: photo });
      setEditing(null);
    } catch {
      Alert.alert("Couldn't save your changes", "The report may have just been closed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(
    () =>
      subscribeToRelevantCivicReports(uid, (m, c) => {
        setMine([...m].sort(newestFirst));
        setConfirmed([...c].sort(newestFirst));
      }),
    [uid]
  );

  const empty = mine.length === 0 && confirmed.length === 0;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="My reports" onBack={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {empty && (
          <EmptyState
            icon="document-text-outline"
            title="No city reports yet"
            message="When a hazard has enough confirmations you can report it to the city, and you'll follow it here."
          />
        )}
        {mine.length > 0 && <Text style={styles.section}>Filed by you</Text>}
        {mine.map((r) => (
          <CivicReportCard key={r.id} report={r}>
            {isOpenStatus(r.status) && (
              <Button
                label="Edit note or photo"
                onPress={() => setEditing(r)}
                variant="outline"
                size="sm"
                icon="create-outline"
                style={styles.editBtn}
              />
            )}
          </CivicReportCard>
        ))}
        {confirmed.length > 0 && <Text style={styles.section}>Hazards you helped confirm</Text>}
        {confirmed.map((r) => (
          <CivicReportCard key={r.id} report={r} />
        ))}
      </ScrollView>
      <CivicReportSheet
        visible={editing !== null}
        mode="edit"
        kind={editing?.kind ?? "pothole"}
        address={editing?.address ?? null}
        confirmers={editing?.confirmerCount ?? 0}
        days={0}
        submitting={saving}
        initialNotes={editing?.notes ?? ""}
        initialPhoto={editing?.photoUrl ?? null}
        onClose={() => setEditing(null)}
        onSubmit={(notes, photo) => void saveEdit(notes, photo)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editBtn: { marginTop: space.md },
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56 },
  headerWrap: { paddingHorizontal: space.lg },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl },
  section: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 13,
    color: colors.neutral.inkSoft,
    marginBottom: space.sm,
    marginTop: space.sm,
  },
});
