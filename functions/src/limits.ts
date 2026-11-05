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

export const PUBLISH_EDITS_PER_DAY = 20; // fixing or hiding a published card: each one makes the saved answers stale
// The bill: AI calls stop once the recorded cost (usage/<day>.usd, usage.ts) reaches either of these. The
// organisation's monthly limit in the Anthropic Console is shared with other apps, so the app keeps well inside it.
export const USD_PER_DAY = 40; // one day (Japan time)
export const USD_TOTAL = 150; // all days from USD_FROM on (the judging period)
export const USD_FROM = "2026-11-05";
const MAX_BUDGET_DAYS = 62; // the total reads one document per day: bounded

// userMsg takes the cap in force, so a cap raised in config/limits shows its own number.
export const CAPS = {
  claude: { prefix: "", user: PER_USER_PER_DAY, ip: PER_IP_PER_DAY, all: ALL_USERS_PER_DAY, userMsg: (n: number) => `今日はこの端末で ${n} 回まで使えます。また明日お試しください。例題の質問はいつでも試せます。`, allMsg: "今日の利用回数の上限に達しました。また明日お試しください。例題の質問はいつでも試せます。" },
  // A saved answer calls no Claude but still writes the answer record: a loose cap of its own.
  cached: { prefix: "c_", user: 200, ip: 600, all: 20000, userMsg: () => "今日はこの端末からの質問が多すぎます。また明日お試しください。", allMsg: "今日の利用回数の上限に達しました。また明日お試しください。" },
  photo: { prefix: "photo_", user: 20, ip: 60, all: PHOTOS_PER_DAY, userMsg: (n: number) => `写真で調べられるのは、この端末から1日${n}回までです。`, allMsg: "今日の写真の判定は上限に達しました。また明日お試しください。" },
  box: { prefix: "box_", user: BOX_PER_USER_PER_DAY, ip: BOX_PER_USER_PER_DAY * 3, all: BOX_ALL_USERS_PER_DAY, userMsg: (n: number) => `質問箱に送れるのは、この端末から1日 ${n} 件までです。`, allMsg: "今日は質問箱がいっぱいです。また明日お試しください。" },
  publish: { prefix: "pub_", user: PUBLISH_PER_USER_PER_DAY, ip: PUBLISH_PER_USER_PER_DAY * 3, all: PUBLISH_ALL_USERS_PER_DAY, userMsg: (n: number) => `新しく公開できるカードは、この端末から1日 ${n} 枚までです。`, allMsg: "今日はこれ以上カードを公開できません。また明日お試しください。" },
  edit: { prefix: "ed_", user: PUBLISH_EDITS_PER_DAY, ip: PUBLISH_EDITS_PER_DAY * 3, all: 300, userMsg: (n: number) => `公開したカードの直し・公開と非公開の切り替えは、この端末から1日 ${n} 回までです。`, allMsg: "今日はこれ以上カードを直せません。また明日お試しください。" },
  transferMake: { prefix: "trm_", user: 5, ip: 20, all: 2000, userMsg: (n: number) => `引き継ぎコードを出せるのは、1日${n}回までです。`, allMsg: "今日は引き継ぎが混み合っています。また明日お試しください。" },
  transfer: { prefix: "tr_", user: 5, ip: 20, all: 2000, userMsg: (n: number) => `引き継ぎコードを入れられるのは、1日${n}回までです。`, allMsg: "今日は引き継ぎが混み合っています。また明日お試しください。" },
} as const;
export type QuotaKind = keyof typeof CAPS;

/**
 * The caps can be changed on the day without a deploy: the document config/limits (closed to clients by the rules),
 * e.g. { "claude": { "user": 60, "all": 900 }, "usdPerDay": 40 }. Missing or broken values keep the defaults above.
 * Read at most once a minute per instance.
 */
export interface LimitsConfig {
  caps: Partial<Record<QuotaKind, { user?: number; ip?: number; all?: number }>>;
  usdPerDay?: number;
  usdTotal?: number;
  usdFrom?: string; // YYYY-MM-DD
}
const CONFIG_TTL = 60_000;
let config: { at: number; v: LimitsConfig } | null = null;

const count0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

/** Only non-negative numbers for known kinds are taken: a typo in the console must not lift every cap. */
export function parseLimitsConfig(raw: Record<string, unknown> | undefined): LimitsConfig {
  const caps: LimitsConfig["caps"] = {};
  for (const kind of Object.keys(CAPS) as QuotaKind[]) {
    const o = raw?.[kind] as Record<string, unknown> | undefined;
    if (!o || typeof o !== "object") continue;
    const c = { user: count0(o.user), ip: count0(o.ip), all: count0(o.all) };
    caps[kind] = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined));
  }
  const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  const from = typeof raw?.usdFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.usdFrom) ? raw.usdFrom : undefined;
  const out: LimitsConfig = { caps };
  if (money(raw?.usdPerDay) !== undefined) out.usdPerDay = money(raw?.usdPerDay);
  if (money(raw?.usdTotal) !== undefined) out.usdTotal = money(raw?.usdTotal);
  if (from) out.usdFrom = from;
  return out;
}

export async function limitsConfig(now = Date.now()): Promise<LimitsConfig> {
  if (config && now - config.at < CONFIG_TTL) return config.v;
  let v: LimitsConfig = { caps: {} };
  try {
    v = parseLimitsConfig((await db.doc("config/limits").get()).data());
  } catch (e) {
    console.warn("config/limits could not be read; using the defaults", e);
  }
  config = { at: now, v };
  return v;
}

/** The cap in force for one kind: the default, with what config/limits sets. */
export function capOf(kind: QuotaKind, cfg: LimitsConfig = { caps: {} }) {
  const base = CAPS[kind];
  const o = cfg.caps[kind] ?? {};
  const user = o.user ?? base.user;
  return { prefix: base.prefix, user, ip: o.ip ?? base.ip, all: o.all ?? base.all, userMsg: base.userMsg(user), allMsg: base.allMsg };
}

const BUDGET_MSG = "いまは混み合っています。時間をおいてからお試しください。例題の質問はいつでも試せます。";

/** The days from `from` to `to` (both YYYY-MM-DD, inclusive), at most MAX_BUDGET_DAYS of the latest. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${to}T00:00:00Z`); days.length < MAX_BUDGET_DAYS && new Date(t).toISOString().slice(0, 10) >= from; t -= 86_400_000)
    days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Whether the recorded spending is over either budget (pure, for the tests). */
export function overBudget(dayUsd: number, totalUsd: number, cfg: LimitsConfig = { caps: {} }): boolean {
  return dayUsd >= (cfg.usdPerDay ?? USD_PER_DAY) || totalUsd >= (cfg.usdTotal ?? USD_TOTAL);
}

/**
 * The bill as the last stop: the counts bound the number of calls, this bounds what they cost (one long interview
 * costs several questions). Refused once the day's or the period's recorded total (usage.ts) reaches the budget.
 */
export async function checkBudget(now = Date.now(), cfg?: LimitsConfig): Promise<void> {
  const c = cfg ?? (await limitsConfig(now));
  const day = today(now);
  const days = daysBetween(c.usdFrom ?? USD_FROM, day);
  const docs = await db.getAll(...(days.length ? days : [day]).map((d) => db.doc(`usage/${d}`)));
  const usd = (s: FirebaseFirestore.DocumentSnapshot) => (s.get("usd") as number | undefined) ?? 0;
  const dayUsd = docs.find((s) => s.id === day);
  if (overBudget(dayUsd ? usd(dayUsd) : 0, docs.reduce((t, s) => t + usd(s), 0), c)) throw over(BUDGET_MSG);
}

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
  const cfg = await limitsConfig(now);
  const cap = capOf(kind, cfg);
  if (kind === "claude" || kind === "photo") await checkBudget(now, cfg);
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

/**
 * Takes back one use counted by takeQuota (the call failed on Claude's side, e.g. it was busy), so a failure
 * the user could not help does not use up their day. Any shard will do: the overall count is their sum.
 */
export async function giveBackQuota(uid: string, kind: QuotaKind = "claude", ip = "", now = Date.now()): Promise<void> {
  const cap = CAPS[kind];
  const day = today(now);
  const usage = db.collection("usage");
  const add = { count: FieldValue.increment(-1), day };
  const b = db.batch();
  b.set(usage.doc(`${day}_${cap.prefix}${uid}`), add, { merge: true });
  if (ip) b.set(usage.doc(`${day}_${cap.prefix}ip_${ipKey(ip, day)}`), add, { merge: true });
  b.set(usage.doc(`${day}_${cap.prefix}all_${randomInt(SHARDS)}`), add, { merge: true });
  await b.commit();
}
