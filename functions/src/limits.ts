import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

// Daily caps, so an exposed URL cannot run up the API bill (claude) or fill the question box (box).
export const PER_USER_PER_DAY = 40;
export const ALL_USERS_PER_DAY = 600;
export const BOX_PER_USER_PER_DAY = 20;
export const BOX_ALL_USERS_PER_DAY = 300;

const CAPS = {
  claude: { prefix: "", user: PER_USER_PER_DAY, all: ALL_USERS_PER_DAY, userMsg: `今日はこの端末で ${PER_USER_PER_DAY} 回まで使えます。また明日お試しください。`, allMsg: "今日の利用回数の上限に達しました。また明日お試しください。" },
  box: { prefix: "box_", user: BOX_PER_USER_PER_DAY, all: BOX_ALL_USERS_PER_DAY, userMsg: `質問箱に送れるのは、この端末から1日 ${BOX_PER_USER_PER_DAY} 件までです。`, allMsg: "今日は質問箱がいっぱいです。また明日お試しください。" },
} as const;

function today(): string {
  // Japan time, so the count resets at midnight JST.
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** Counts one Claude-backed call (or one question-box post) for this user, or throws when a cap is reached. */
export async function takeQuota(uid: string, kind: keyof typeof CAPS = "claude"): Promise<void> {
  const cap = CAPS[kind];
  const day = today();
  const userRef = db.collection("usage").doc(`${day}_${cap.prefix}${uid}`);
  const allRef = db.collection("usage").doc(`${day}_${cap.prefix}all`);
  await db.runTransaction(async (tx) => {
    const [u, a] = await Promise.all([tx.get(userRef), tx.get(allRef)]);
    if ((u.get("count") ?? 0) >= cap.user) throw new HttpsError("resource-exhausted", cap.userMsg);
    if ((a.get("count") ?? 0) >= cap.all) throw new HttpsError("resource-exhausted", cap.allMsg);
    tx.set(userRef, { count: FieldValue.increment(1), day }, { merge: true });
    tx.set(allRef, { count: FieldValue.increment(1), day }, { merge: true });
  });
}
