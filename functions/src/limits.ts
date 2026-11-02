import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

// Daily caps on Claude calls, so an exposed URL cannot run up the API bill.
export const PER_USER_PER_DAY = 40;
export const ALL_USERS_PER_DAY = 600;

function today(): string {
  // Japan time, so the count resets at midnight JST.
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** Counts one Claude-backed call for this user, or throws when a cap is reached. */
export async function takeQuota(uid: string): Promise<void> {
  const day = today();
  const userRef = db.collection("usage").doc(`${day}_${uid}`);
  const allRef = db.collection("usage").doc(`${day}_all`);
  await db.runTransaction(async (tx) => {
    const [u, a] = await Promise.all([tx.get(userRef), tx.get(allRef)]);
    if ((u.get("count") ?? 0) >= PER_USER_PER_DAY) {
      throw new HttpsError("resource-exhausted", `今日はこの端末で ${PER_USER_PER_DAY} 回まで使えます。また明日お試しください。`);
    }
    if ((a.get("count") ?? 0) >= ALL_USERS_PER_DAY) {
      throw new HttpsError("resource-exhausted", "今日の利用回数の上限に達しました。また明日お試しください。");
    }
    tx.set(userRef, { count: FieldValue.increment(1), day }, { merge: true });
    tx.set(allRef, { count: FieldValue.increment(1), day }, { merge: true });
  });
}
