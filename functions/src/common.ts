import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

if (!getApps().length) initializeApp();
export const db = getFirestore();
export const COMPANY = "demo";

/**
 * Where this caller's cards and questions go. People who came in through 「審査員の方はこちら」 send trial: true:
 * what they publish or send is seen only by themselves (they still go round the whole loop), so the next person
 * does not see it. A caller can only ever choose their own trial space, so the flag needs no trust.
 */
export function spaceOf(data: Record<string, unknown>, uid: string): string {
  return data.trial === true ? `trial_${uid}` : COMPANY;
}

/** The spaces this caller reads: the shared one, plus their own trial space. */
export function spacesOf(data: Record<string, unknown>, uid: string): string[] {
  const own = spaceOf(data, uid);
  return own === COMPANY ? [COMPANY] : [COMPANY, own];
}

export type Source = "law" | "wisdom" | "general";
export interface Sentence {
  text: string;
  source: Source;
  cardId?: string;
  lawId?: string;
  quote?: string;
  verified?: boolean;
}
export interface Turn {
  role: "veteran" | "ai";
  text: string;
}
export const CATEGORIES = ["piping", "wiring", "grounding", "license", "calc", "safety", "other"] as const;
export const LOCATIONS = ["ceiling", "floor", "outdoor", "panel", "other"] as const;

export interface CardDoc {
  companyId: string;
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  relatedLaws: string[];
  tags: string[];
  category: (typeof CATEGORIES)[number];
  location: (typeof LOCATIONS)[number];
  // who wrote it lives in cardPrivate (authorId): a public card must not link a hidden name to a named one.
  // Cards published before that change may still carry authorId here (scripts/migrate-private.mjs moves it).
  authorId?: string;
  authorName: string;
  showAuthorName: boolean;
  status: "draft" | "published" | "private";
  visibility: "company" | "region" | "national";
  region: string | null;
  powerCompany: string | null;
  confirmations: { name: string; at: Timestamp; by?: string }[]; // by: only on cards from before cardPrivate
  helpedCount: number;
  viewCount: number;
  triggerQuestionId: string | null;
  triggerAskerName: string | null;
  triggerQuestionText: string | null;
  triggerSearchText?: string | null; // see search.ts
  transcript: Turn[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt: Timestamp | null;
}

// --- input checks (callable data is untrusted) ---
export function str(v: unknown, name: string, max = 2000, required = true): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpsError("invalid-argument", `${name}を入れてください`);
    return "";
  }
  if (typeof v !== "string") throw new HttpsError("invalid-argument", `${name}の形式が違います`);
  const s = v.trim();
  if (s.length > max) throw new HttpsError("invalid-argument", `${name}が長すぎます（${max}字まで）`);
  if (required && !s) throw new HttpsError("invalid-argument", `${name}を入れてください`);
  return s;
}

export function strList(v: unknown, name: string, maxItems = 20, maxLen = 60): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItems) throw new HttpsError("invalid-argument", `${name}は${maxItems}個までです`);
  return v.map((x) => str(x, name, maxLen)).filter(Boolean);
}

export function turns(v: unknown): Turn[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) throw new HttpsError("invalid-argument", "やりとりが長すぎるか、空です");
  return v.map((t) => {
    const role = (t as Turn)?.role;
    if (role !== "veteran" && role !== "ai") throw new HttpsError("invalid-argument", "transcript role is invalid");
    return { role, text: str((t as Turn).text, "話した内容", 3000) };
  });
}

export function displayAuthor(c: Pick<CardDoc, "showAuthorName" | "authorName">): string {
  return c.showAuthorName && c.authorName ? c.authorName : "社内のベテラン";
}

const SAFETY = /活線|感電|通電|充電部|高圧|停電作業|検電|資格|無資格|変圧器|短絡|スパーク/;
export function safetyNote(text: string): string | null {
  return SAFETY.test(text)
    ? "感電・資格が関わる内容です。作業の可否と手順は、必ず有資格者・責任者の指示に従ってください。"
    : null;
}
