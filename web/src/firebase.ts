import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { collection, connectFirestoreEmulator, getFirestore, query, where } from "firebase/firestore";
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

/** The message to show for a failed call: the server's own words for limits and bad input, otherwise `fallback`. */
export function errorText(e: unknown, fallback: string): string {
  const code = (e as { code?: string })?.code ?? "";
  // the SDK may add the HTTP status ("…ください [400]"): the person only needs the words
  const message = ((e as { message?: string })?.message ?? "").replace(/\s*\[\d{3}\]\s*$/, "");
  // only our Japanese messages are shown as they are (not "internal" etc.)
  return (code === "functions/resource-exhausted" || code === "functions/invalid-argument" || code === "functions/not-found" || code === "functions/failed-precondition" || code === "functions/permission-denied" || code === "functions/unavailable") && /[ぁ-んァ-ン一-龥]/.test(message) ? message : fallback;
}

export async function call<T>(name: string, data: unknown): Promise<T> {
  // a little longer than the server (120 s): a slow answer that does arrive is not shown as a failure
  const fn = httpsCallable(functions, name, { timeout: 125_000 });
  const res = await fn(getTrial() ? { ...(data as object), trial: true } : data);
  return res.data as T;
}

export const COMPANY = "demo";

/** The spaces this device reads: the shared one, plus its own trial space when it came in as a judge. */
export const spaces = () => (getTrial() && myId() ? [COMPANY, "trial_" + myId()] : [COMPANY]);

/**
 * The mark of a card let out by the check against the articles (functions/src/common.ts LAW_CHECK_VER; firestore.rules
 * has the same number). Only marked cards are readable, so the query must ask for it.
 */
export const LAW_CHECK_VER = 1;
/** The published cards young workers may read (this device's spaces, let out by the check). */
export const youngCards = () =>
  query(collection(db, "cards"), where("companyId", "in", spaces()), where("status", "==", "published"), where("lawCheckVer", "==", LAW_CHECK_VER));
