import { createHash, randomInt } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

// Daily caps, so an exposed URL cannot run up the API bill (claude), fill the question box (box)
// or flood the answers with cards (publish).
// Anonymous accounts cost nothing to make, so each cap also counts per network address (ip): a new
// account on the same connection does not start from zero. The overall cap is what bounds the bill.
export const PER_USER_PER_DAY = 40;
export const PER_IP_PER_DAY = 150; // several judges on one Wi-Fi share this
export const ALL_USERS_PER_DAY = 600;
export const BOX_PER_USER_PER_DAY = 20;
export const BOX_ALL_USERS_PER_DAY = 300;
export const PUBLISH_PER_USER_PER_DAY = 10;
export const PUBLISH_ALL_USERS_PER_DAY = 100;

export const CAPS = {
  claude: { prefix: "", user: PER_USER_PER_DAY, ip: PER_IP_PER_DAY, all: ALL_USERS_PER_DAY, userMsg: `今日はこの端末で ${PER_USER_PER_DAY} 回まで使えます。また明日お試しください。`, allMsg: "今日の利用回数の上限に達しました。また明日お試しください。" },
  box: { prefix: "box_", user: BOX_PER_USER_PER_DAY, ip: BOX_PER_USER_PER_DAY * 3, all: BOX_ALL_USERS_PER_DAY, userMsg: `質問箱に送れるのは、この端末から1日 ${BOX_PER_USER_PER_DAY} 件までです。`, allMsg: "今日は質問箱がいっぱいです。また明日お試しください。" },
  publish: { prefix: "pub_", user: PUBLISH_PER_USER_PER_DAY, ip: PUBLISH_PER_USER_PER_DAY * 3, all: PUBLISH_ALL_USERS_PER_DAY, userMsg: `新しく公開できるカードは、この端末から1日 ${PUBLISH_PER_USER_PER_DAY} 枚までです。`, allMsg: "今日はこれ以上カードを公開できません。また明日お試しください。" },
  transfer: { prefix: "tr_", user: 5, ip: 20, all: 2000, userMsg: "引き継ぎコードを入れられるのは、1日5回までです。", allMsg: "今日は引き継ぎが混み合っています。また明日お試しください。" },
} as const;
export type QuotaKind = keyof typeof CAPS;

// The overall count is spread over shards: one hot document made parallel calls abort on lock timeouts.
export const SHARDS = 10;

export function today(now = Date.now()): string {
  // Japan time, so the count resets at midnight JST.
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/** The address is stored only as a short salted hash. */
const ipKey = (ip: string, day: string) => createHash("sha256").update(`${day}|${ip}`).digest("hex").slice(0, 24);

/**
 * Counts one use for this user (and network address), or throws resource-exhausted when a cap is reached.
 * No transaction: parallel calls on one hot document aborted on lock timeouts. Instead each call adds itself
 * first and then reads the counts; a call whose count is over a cap is refused. A count read after adding
 * is never below the caller's own place in line, so no more calls than a cap can ever pass. Near a cap,
 * calls racing each other may both be refused (the safe side). Callers already over a cap are refused
 * before adding, so they do not use up the overall budget.
 */
export async function takeQuota(uid: string, kind: QuotaKind = "claude", ip = "", now = Date.now()): Promise<void> {
  const cap = CAPS[kind];
  const day = today(now);
  const usage = db.collection("usage");
  const shards = Array.from({ length: SHARDS }, (_, i) => usage.doc(`${day}_${cap.prefix}all_${i}`));
  const userRef = usage.doc(`${day}_${cap.prefix}${uid}`);
  const ipRef = ip ? usage.doc(`${day}_${cap.prefix}ip_${ipKey(ip, day)}`) : null;
  const refs = [userRef, ...(ipRef ? [ipRef] : []), ...shards];

  const counts = async () => {
    const snaps = await db.getAll(...refs);
    const n = (i: number) => (snaps[i].get("count") as number | undefined) ?? 0;
    const total = snaps.slice(ipRef ? 2 : 1).reduce((t, x) => t + ((x.get("count") as number | undefined) ?? 0), 0);
    return { user: n(0), ip: ipRef ? n(1) : 0, total };
  };
  const refuse = (c: { user: number; ip: number; total: number }, over: (n: number, max: number) => boolean) => {
    if (over(c.user, cap.user)) throw new HttpsError("resource-exhausted", cap.userMsg);
    if (ipRef && over(c.ip, cap.ip)) throw new HttpsError("resource-exhausted", "今日は同じ回線からの利用が上限に達しました。また明日お試しください。");
    if (over(c.total, cap.all)) throw new HttpsError("resource-exhausted", cap.allMsg);
  };

  refuse(await counts(), (n, max) => n >= max); // already full: refuse without counting
  const add = { count: FieldValue.increment(1), day };
  const batch = db.batch();
  batch.set(userRef, add, { merge: true });
  if (ipRef) batch.set(ipRef, add, { merge: true });
  batch.set(shards[randomInt(SHARDS)], add, { merge: true });
  await batch.commit();
  refuse(await counts(), (n, max) => n > max); // our own use is in the count now
}
