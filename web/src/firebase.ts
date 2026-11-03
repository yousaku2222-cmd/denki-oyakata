import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getTrial } from "./local";

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

export async function call<T>(name: string, data: unknown): Promise<T> {
  const fn = httpsCallable(functions, name);
  const res = await fn(getTrial() ? { ...(data as object), trial: true } : data);
  return res.data as T;
}

export const COMPANY = "demo";

/** The spaces this device reads: the shared one, plus its own trial space when it came in as a judge. */
export const spaces = () => (getTrial() && myId() ? [COMPANY, "trial_" + myId()] : [COMPANY]);
