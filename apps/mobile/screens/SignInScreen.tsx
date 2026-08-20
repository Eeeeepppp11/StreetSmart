import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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
        <Text style={styles.title}>PotholeProof</Text>
        <Text style={styles.tagline}>Every commute is a road survey.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {mode === "signIn" ? "Sign in" : "Create your account"}
        </Text>

        {mode === "signUp" && (
          <TextInput
            style={styles.input}
            placeholder="Name"
            placeholderTextColor="#9aa3ad"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9aa3ad"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9aa3ad"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          style={[styles.primaryBtn, busy && styles.disabled]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {mode === "signIn" ? "Sign in" : "Create account"}
            </Text>
          )}
        </Pressable>

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
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f7f9",
    justifyContent: "center",
    padding: 24,
  },
  header: { marginBottom: 28, alignItems: "center" },
  title: { fontSize: 34, fontWeight: "800", color: "#1a1d21" },
  tagline: { fontSize: 15, color: "#5b6570", marginTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#1a1d21", marginBottom: 14 },
  input: {
    alignSelf: "stretch",
    backgroundColor: "#f6f7f9",
    borderWidth: 1,
    borderColor: "#e3e6ea",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1d21",
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: "#e8442e",
    paddingVertical: 16,
    borderRadius: 999,
    marginTop: 6,
    alignItems: "center",
  },
  disabled: { opacity: 0.6 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  switchBtn: { marginTop: 16, alignItems: "center" },
  switchText: { color: "#e8442e", fontSize: 14, fontWeight: "600" },
});
