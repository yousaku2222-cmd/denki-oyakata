import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

// Real values come from web/.env.local once the Firebase project exists.
// Without them the app talks to the local emulators (project "demo-denki-oyakata").
const env = import.meta.env;
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY ?? "demo-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "demo-denki-oyakata",
  appId: env.VITE_FIREBASE_APP_ID,
});

export const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-northeast1");

const useEmulator = !env.VITE_FIREBASE_PROJECT_ID || env.VITE_USE_EMULATOR === "1";
if (useEmulator) {
  const host = location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
}

// No login screen: each device signs in anonymously, and the server trusts only this verified id.
export const signedIn: Promise<string> = new Promise((resolve, reject) => {
  const stop = onAuthStateChanged(auth, (user) => {
    if (user) {
      stop();
      resolve(user.uid);
    }
  });
  signInAnonymously(auth).catch(reject);
});

export const myId = () => auth.currentUser?.uid ?? "";

/** The message to show for a failed call: the server's own words for limits and bad input, otherwise `fallback`. */
export function errorText(e: unknown, fallback: string): string {
  const code = (e as { code?: string })?.code ?? "";
  const message = (e as { message?: string })?.message ?? "";
  // only our Japanese messages are shown as they are (not "internal" etc.)
  return (code === "functions/resource-exhausted" || code === "functions/invalid-argument") && /[ぁ-んァ-ン一-龥]/.test(message) ? message : fallback;
}

export async function call<T>(name: string, data: unknown): Promise<T> {
  const fn = httpsCallable(functions, name);
  const res = await fn(data);
  return res.data as T;
}

export const COMPANY = "demo";
