import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import { initializeAuth } from "firebase/auth";
// @ts-expect-error — getReactNativePersistence exists at runtime (Metro resolves the SDK's
// "react-native" package export) but isn't in the published firebase/auth .d.ts. See
// https://github.com/firebase/firebase-js-sdk/issues/8332
import { getReactNativePersistence } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn(
    "Firebase config is missing — check apps/mobile/.env (see .env.example) and restart Expo with a cleared cache."
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
