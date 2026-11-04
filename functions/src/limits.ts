import { createHash, randomInt } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

// Daily caps, so an exposed URL cannot run up the API bill (claude), fill the question box (box)
// or flood the answers with cards (publish).
// Anonymous accounts cost nothing to make, so each cap also counts per network address (ip): a new
// account on the same connection does not start from zero. The overall cap is what bounds the bill.
export const PER_USER_PER_DAY = 40;
export const PER_IP_PER_DAY = 300; // several judges on one Wi-Fi share this (the overall cap below still bounds the cost)
export const ALL_USERS_PER_DAY = 600;
export const BOX_PER_USER_PER_DAY = 20;
export const BOX_ALL_USERS_PER_DAY = 300;
export const PUBLISH_PER_USER_PER_DAY = 10;
export const PUBLISH_ALL_USERS_PER_DAY = 100;
export const PHOTOS_PER_DAY = 150; // a photo also counts as two answers (index.ts); this caps photos on their own

export const CAPS = {
  claude: { prefix: "", user: PER_USER_PER_DAY, ip: PER_IP_PER_DAY, all: ALL_USERS_PER_DAY, userMsg: `今日はこの端末で ${PER_USER_PER_DAY} 回まで使えます。また明日お試しください。例題の質問はいつでも試せます。`, allMsg: "今日の利用回数の上限に達しました。また明日お試しください。例題の質問はいつでも試せます。" },
  // A saved answer calls no Claude but still writes the answer record: a loose cap of its own.
  cached: { prefix: "c_", user: 200, ip: 600, all: 20000, userMsg: "今日はこの端末からの質問が多すぎます。また明日お試しください。", allMsg: "今日の利用回数の上限に達しました。また明日お試しください。" },
  photo: { prefix: "photo_", user: 20, ip: 60, all: PHOTOS_PER_DAY, userMsg: "写真で調べられるのは、この端末から1日20回までです。", allMsg: "今日の写真の判定は上限に達しました。また明日お試しください。" },
  box: { prefix: "box_", user: BOX_PER_USER_PER_DAY, ip: BOX_PER_USER_PER_DAY * 3, all: BOX_ALL_USERS_PER_DAY, userMsg: `質問箱に送れるのは、この端末から1日 ${BOX_PER_USER_PER_DAY} 件までです。`, allMsg: "今日は質問箱がいっぱいです。また明日お試しください。" },
  publish: { prefix: "pub_", user: PUBLISH_PER_USER_PER_DAY, ip: PUBLISH_PER_USER_PER_DAY * 3, all: PUBLISH_ALL_USERS_PER_DAY, userMsg: `新しく公開できるカードは、この端末から1日 ${PUBLISH_PER_USER_PER_DAY} 枚までです。`, allMsg: "今日はこれ以上カードを公開できません。また明日お試しください。" },
  transferMake: { prefix: "trm_", user: 5, ip: 20, all: 2000, userMsg: "引き継ぎコードを出せるのは、1日5回までです。", allMsg: "今日は引き継ぎが混み合っています。また明日お試しください。" },
  transfer: { prefix: "tr_", user: 5, ip: 20, all: 2000, userMsg: "引き継ぎコードを入れられるのは、1日5回までです。", allMsg: "今日は引き継ぎが混み合っています。また明日お試しください。" },
} as const;
export type QuotaKind = keyof typeof CAPS;

// The overall count is spread over shards: one hot document made parallel calls abort on lock timeouts.
export const SHARDS = 10;

export function today(now = Date.now()): string {
  // Japan time, so the count resets at midnight JST.
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Groups an address the way one subscriber holds it: an IPv4 address as is, an IPv6 address by its /64
 * (one home or phone gets a whole /64, so counting single IPv6 addresses would count nothing).
 */
export function ipGroup(ip: string): string {
  const a = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = a.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/); // also ::ffff:1.2.3.4
  if (v4) return v4[1];
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${full.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":")}::/64`;
}

/**
 * Google's front end appends the address it saw to X-Forwarded-For (the front is whatever the client sent), and may
 * append its own proxy after it: the last entry outside Google's proxy ranges is the client. Checked in production:
 * a PC and a phone on mobile data counted as two addresses.
 */
export function callerIp(xff: string | string[] | undefined, socketIp?: string): string {
  const list = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.filter((ip) => !/^35[.]191[.]|^130[.]211[.][0-3][.]/.test(ip)).at(-1) ?? socketIp ?? "";
}

/** The address is stored only as a short salted hash. */
const ipKey = (ip: string, day: string) => createHash("sha256").update(`${day}|${ipGroup(ip)}`).digest("hex").slice(0, 24);

const over = (msg: string) => new HttpsError("resource-exhausted", msg);
const IP_MSG = "今日は同じ回線からの利用が上限に達しました。また明日お試しください。";

/**
 * Counts one use for this user (and network address), or throws resource-exhausted when a cap is reached.
 * No transactions (one hot document made parallel calls abort on lock timeouts). Each step adds first, then
 * reads; a count read after adding is never below the caller's own place in line, so no more calls than a
 * cap can pass. A refused call takes its additions back, so refused calls use up nothing:
 *   1. this user and this address: add, read, refuse (and undo) if over
 *   2. only then the overall count (spread over shards): add, read, refuse (and undo) if over
 * So one account can add to the overall count only what its own cap allows, however many calls it fires
 * at once. Near a cap, calls racing each other may all be refused (the safe side).
 */
export async function takeQuota(uid: string, kind: QuotaKind = "claude", ip = "", now = Date.now()): Promise<void> {
  const cap = CAPS[kind];
  const day = today(now);
  const usage = db.collection("usage");
  const count = (s: FirebaseFirestore.DocumentSnapshot) => (s.get("count") as number | undefined) ?? 0;
  const add = (n: number) => ({ count: FieldValue.increment(n), day });
  const own = [usage.doc(`${day}_${cap.prefix}${uid}`), ...(ip ? [usage.doc(`${day}_${cap.prefix}ip_${ipKey(ip, day)}`)] : [])];
  const shards = Array.from({ length: SHARDS }, (_, i) => usage.doc(`${day}_${cap.prefix}all_${i}`));

  // already full: refuse without adding anything
  const before = await db.getAll(...own, ...shards);
  if (count(before[0]) >= cap.user) throw over(cap.userMsg);
  if (ip && count(before[1]) >= cap.ip) throw over(IP_MSG);
  if (before.slice(own.length).reduce((t, s) => t + count(s), 0) >= cap.all) throw over(cap.allMsg);

  // 1. this user and this address
  const batch = db.batch();
  for (const r of own) batch.set(r, add(1), { merge: true });
  await batch.commit();
  const mine = await db.getAll(...own);
  const undoOwn = async () => {
    const b = db.batch();
    for (const r of own) b.set(r, add(-1), { merge: true });
    await b.commit();
  };
  if (count(mine[0]) > cap.user || (ip && count(mine[1]) > cap.ip)) {
    await undoOwn();
    throw over(count(mine[0]) > cap.user ? cap.userMsg : IP_MSG);
  }

  // 2. the overall count
  const shard = shards[randomInt(SHARDS)];
  await shard.set(add(1), { merge: true });
  const total = (await db.getAll(...shards)).reduce((t, s) => t + count(s), 0);
  if (total > cap.all) {
    await shard.set(add(-1), { merge: true });
    await undoOwn();
    throw over(cap.allMsg);
  }
}
