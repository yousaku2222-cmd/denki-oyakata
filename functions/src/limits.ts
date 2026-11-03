import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

// Daily caps, so an exposed URL cannot run up the API bill or fill the shared box.
// Anonymous sign-in makes a new uid per private window, so the network address is counted too.
export const PER_USER_PER_DAY = 40;
export const PER_IP_PER_DAY = 120; // several people on one office network still fit
export const ALL_USERS_PER_DAY = 600;
export const PHOTOS_PER_DAY = 150; // a photo costs about two answers, so it also has its own cap
export const WRITES_PER_USER_PER_DAY = 20; // publishing cards and sending questions (no Claude, but shared with everyone)
export const WRITES_PER_IP_PER_DAY = 60;

export function today(now = Date.now()): string {
  // Japan time, so the count resets at midnight JST.
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The caller's network address as a short hash (the address itself is never stored).
 * The front of X-Forwarded-For is whatever the caller sent, so it is read from the right:
 * Google appends the real client address (and may append its own proxy after it).
 */
export function ipKey(forwardedFor: string | string[] | undefined, socketIp: string | undefined): string {
  const list = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const client = list.filter((ip) => !isGoogleProxy(ip)).pop() ?? socketIp ?? "unknown";
  return createHash("sha256").update(`denki-oyakata:${client}`).digest("hex").slice(0, 16);
}

// Google's load-balancer / front-end ranges (they appear after the client address, never as the client).
function isGoogleProxy(ip: string): boolean {
  return /^35\.191\./.test(ip) || /^130\.211\.[0-3]\./.test(ip);
}

interface Count {
  id: string;
  cap: number;
  by: number;
  message: string;
}

async function take(counts: Count[]): Promise<void> {
  const refs = counts.map((c) => db.collection("usage").doc(c.id));
  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((s, i) => {
      if ((s.get("count") ?? 0) + counts[i].by > counts[i].cap) throw new HttpsError("resource-exhausted", counts[i].message);
    });
    refs.forEach((r, i) => tx.set(r, { count: FieldValue.increment(counts[i].by), day: today() }, { merge: true }));
  });
}

const AGAIN = "また明日お試しください。例題の質問はいつでも試せます。";

/** Counts Claude-backed work (`weight` answers' worth) for this user and network, or throws when a cap is reached. */
export async function takeQuota(uid: string, ip: string, opts: { weight?: number; photo?: boolean } = {}): Promise<void> {
  const day = today();
  const by = opts.weight ?? 1;
  await take([
    { id: `${day}_${uid}`, cap: PER_USER_PER_DAY, by, message: `今日はこの端末で ${PER_USER_PER_DAY} 回分まで使えます。${AGAIN}` },
    { id: `${day}_ip_${ip}`, cap: PER_IP_PER_DAY, by, message: `今日はこの回線から ${PER_IP_PER_DAY} 回分まで使えます。${AGAIN}` },
    { id: `${day}_all`, cap: ALL_USERS_PER_DAY, by, message: `今日の利用回数の上限に達しました。${AGAIN}` },
    ...(opts.photo ? [{ id: `${day}_photo`, cap: PHOTOS_PER_DAY, by: 1, message: `今日の写真の判定は上限に達しました。${AGAIN}` }] : []),
  ]);
}

/** Counts a write that everyone will see (a published card, a question in the box). */
export async function takeWriteQuota(uid: string, ip: string): Promise<void> {
  const day = today();
  await take([
    { id: `${day}_w_${uid}`, cap: WRITES_PER_USER_PER_DAY, by: 1, message: `今日はこの端末から ${WRITES_PER_USER_PER_DAY} 件まで送れます。また明日お試しください。` },
    { id: `${day}_wip_${ip}`, cap: WRITES_PER_IP_PER_DAY, by: 1, message: `今日はこの回線から ${WRITES_PER_IP_PER_DAY} 件まで送れます。また明日お試しください。` },
  ]);
}
