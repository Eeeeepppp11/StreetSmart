import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, radii, space } from "../../theme";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.btn, active && styles.btnActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  btn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  text: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.neutral.ink },
  textActive: { color: colors.white },
});
