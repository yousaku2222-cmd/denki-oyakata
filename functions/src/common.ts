import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { CardSentence, LawCheckSummary, LawRefDoc } from "./lawcheck";

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

/**
 * The mark publishCard / setCardStatus put on every card they let out (cards/{id}.lawCheckVer): the card went out
 * as it was checked against the articles (lawcheck.ts), even one no article is about (it has no ⚖️ badge). A card
 * without it (published before the check, or written some other way) reaches young workers nowhere: answers, 撮る,
 * the box, and 探す (firestore.rules lets clients read marked cards only). Raised together with firestore.rules and
 * web/src/firebase.ts, it sends every card back to be checked again.
 */
export const LAW_CHECK_VER = 1;
/** Whether young workers may get this card: published, and let out by the check (the mark above). */
export const reachesYoung = (c: { status?: unknown; lawCheckVer?: unknown } | undefined) => c?.status === "published" && c.lawCheckVer === LAW_CHECK_VER;

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

/** A word as written on the card (「プルボ」) and what it means (「プルボックス。電線をまとめる箱」). */
export interface FieldTerm {
  word: string;
  meaning: string;
}

export interface CardDoc {
  companyId: string;
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  relatedLaws: string[];
  tags: string[];
  // The veteran's own words (dialect, the company's or the area's names for things) with a meaning for young
  // workers, and the whole card in standard Japanese when the dialect is strong (else ""). Written by the AI with
  // the draft and checked by the veteran; the card's text itself stays as told. Older cards may have neither.
  terms?: FieldTerm[];
  plain?: string;
  // the card's sentences checked against the articles before it was published (lawcheck.ts); older cards: none
  lawCheck?: LawCheckSummary;
  // LAW_CHECK_VER once the card was let out as checked (publishCard / setCardStatus); drafts and older cards: none
  lawCheckVer?: number;
  // its sentences that differ from 公共建築工事標準仕様書 (not law): shown with a note (sentences that differ from a law are not on the card)
  specDiffers?: CardSentence[];
  // its sentences the check found the same as an article or stricter (✅ / 🟦), each with the article and the quote:
  // young workers go from the veteran's words to the article (sentences held back are not on it); older cards: none
  lawRefs?: LawRefDoc[];
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

// The whole interview goes to Claude on every turn: bound its length, not only the turns (20 × 3000 characters would
// cost many questions while counting as one). Five answers of the screen's 3000 characters still fit; the interview
// itself stops asking earlier (interview.ts), so a real talk reaches the card before this.
export const MAX_TRANSCRIPT_CHARS = 16000;

export function turns(v: unknown): Turn[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) throw new HttpsError("invalid-argument", "やりとりが長すぎるか、空です");
  const out = v.map((t) => {
    const role = (t as Turn)?.role;
    if (role !== "veteran" && role !== "ai") throw new HttpsError("invalid-argument", "transcript role is invalid");
    return { role, text: str((t as Turn).text, "話した内容", 3000) };
  });
  if (out.reduce((n, t) => n + t.text.length, 0) > MAX_TRANSCRIPT_CHARS)
    throw new HttpsError("invalid-argument", `話した内容が長すぎます（合わせて${MAX_TRANSCRIPT_CHARS}字まで）。話を分けて、2枚のカードにしてください。`);
  return out;
}

export function displayAuthor(c: Pick<CardDoc, "showAuthorName" | "authorName">): string {
  return c.showAuthorName && c.authorName ? c.authorName : "社内のベテラン";
}

// Electricity and licences; and the work itself (heights, power tools, panels) where people get hurt without a shock.
const SAFETY = /活線|感電|通電|充電部|高圧|停電|検電|資格|無資格|変圧器|短絡|スパーク|分電盤|配電盤|ブレーカ|キュービクル|漏電/;
const WORK_SAFETY = /高所|脚立|足場|墜落|転落|サンダー|グラインダー|切断|はつり|電動工具|ドリル|石綿|アスベスト|酸欠/;
export function safetyNote(text: string): string | null {
  const notes = [
    SAFETY.test(text) && "感電・資格が関わる内容です。作業の可否と手順は、必ず有資格者・責任者の指示に従ってください。",
    WORK_SAFETY.test(text) && "高所・電動工具などの危ない作業です。保護具・特別教育・作業手順を、必ず責任者に確かめてください。",
  ].filter((x): x is string => !!x);
  return notes.length ? notes.join("") : null;
}
