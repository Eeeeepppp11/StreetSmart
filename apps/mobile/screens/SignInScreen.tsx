import { useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../auth/AuthContext";
import { Button, Card } from "../components/ui";
import { colors, fontFamily, radii, space } from "../theme";

function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "An account already exists with that email — try signing in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/network-request-failed":
      return "Couldn't reach the server. Check your connection.";
    default:
      return String((err as { message?: string })?.message ?? err);
  }
}

type Field = "name" | "email" | "password" | null;

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusedField, setFocusedField] = useState<Field>(null);

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert("Missing info", "Enter an email and password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signIn") {
        await signIn(email, password);
      } else {
        await signUp(email, password, name);
      }
    } catch (err) {
      Alert.alert(mode === "signIn" ? "Sign in failed" : "Sign up failed", authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Image
          source={require("../assets/brand/logo-stacked.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="StreetSmart"
        />
      </View>

      <Card>
        <Text style={styles.cardTitle}>
          {mode === "signIn" ? "Sign in" : "Create your account"}
        </Text>

        {mode === "signUp" && (
          <TextInput
            style={[styles.input, focusedField === "name" && styles.inputFocused]}
            placeholder="Name"
            placeholderTextColor={colors.neutral.inkFaint}
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
          />
        )}
        <TextInput
          style={[styles.input, focusedField === "email" && styles.inputFocused]}
          placeholder="Email"
          placeholderTextColor={colors.neutral.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocusedField("email")}
          onBlur={() => setFocusedField(null)}
        />
        <TextInput
          style={[styles.input, focusedField === "password" && styles.inputFocused]}
          placeholder="Password"
          placeholderTextColor={colors.neutral.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
        />

        <Button
          label={mode === "signIn" ? "Sign in" : "Create account"}
          onPress={submit}
          loading={busy}
          variant="primary"
          size="lg"
          style={styles.submitBtn}
        />

        <Pressable
          style={styles.switchBtn}
          onPress={() => setMode((m) => (m === "signIn" ? "signUp" : "signIn"))}
          disabled={busy}
        >
          <Text style={styles.switchText}>
            {mode === "signIn"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </Card>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral.bg,
    justifyContent: "center",
    padding: space.xxl,
  },
  header: { marginBottom: space.xxl + space.xs, alignItems: "center" },
  logo: { width: 220, height: 220 },
  cardTitle: { fontFamily: fontFamily.bodyBold, fontSize: 18, color: colors.neutral.ink, marginBottom: space.md },
  input: {
    alignSelf: "stretch",
    backgroundColor: colors.neutral.bg,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontFamily: fontFamily.body,
    fontSize: 15,
    color: colors.neutral.ink,
    marginBottom: space.sm,
  },
  inputFocused: { borderColor: colors.status.info },
  submitBtn: { marginTop: space.xs },
  switchBtn: { marginTop: space.md, alignItems: "center" },
  switchText: { color: colors.brand.primary, fontFamily: fontFamily.bodySemibold, fontSize: 14 },
});
