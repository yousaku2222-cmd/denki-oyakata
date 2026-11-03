import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreFields } from "./search";

export interface Law {
  id: string;
  lawName: string;
  short: string;
  edition: string;
  article: string;
  heading: string;
  text: string; // original wording, never rewritten
  sourceUrl: string;
  summary: string;
  keywords: string[];
  scenes: string[];
}

// Built once by scripts/laws (original text + Opus summaries) and deployed with the functions.
export const LAWS: Law[] = JSON.parse(readFileSync(join(__dirname, "..", "data", "laws.json"), "utf8"));
const byId = new Map(LAWS.map((l) => [l.id, l]));
export const getLawById = (id: string) => byId.get(id);

export function searchLaws(query: string, limit = 4, min = 0.9): Law[] {
  return LAWS.map((law) => ({
    law,
    score: scoreFields(query, [
      [`${law.short} ${law.article} ${law.heading}`, 3],
      [law.keywords.join(" "), 3],
      [law.summary, 1.5],
      [law.scenes.join(" "), 1],
    ]),
  }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.law);
}

/** Line breaks, spaces and full/half width differ between PDF text and a quote; the words must not. */
export function normalizeForQuote(s: string): string {
  return s.normalize("NFKC").replace(/[\s｜|]/g, "");
}

/** The quote counts only if it appears word for word in the article's original text. */
export function quoteIsInOriginal(quote: string, lawText: string, minLength = 8): boolean {
  const q = normalizeForQuote(quote).replace(/^[「『]|[」』]$/g, "");
  return q.length >= minLength && normalizeForQuote(lawText).includes(q);
}

// --- numbers: a sentence shown as law or wisdom must not carry numbers its source does not have ---
const KANJI_DIGITS = "〇一二三四五六七八九";
const KANJI_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

function kanjiBelowMan(run: string): string {
  if (!run) return "";
  if (![...run].some((c) => c in KANJI_UNITS)) return [...run].map((c) => KANJI_DIGITS.indexOf(c)).join(""); // 二〇二五
  let section = 0;
  let digit = 0;
  for (const c of run) {
    const d = KANJI_DIGITS.indexOf(c);
    if (d >= 0) digit = digit * 10 + d;
    else {
      section += (digit || 1) * KANJI_UNITS[c];
      digit = 0;
    }
  }
  return String(section + digit);
}

// 万 stays a word (四千五百万 → 4500万), the way people write amounts ("4,500万円")
const kanjiRunToNumber = (run: string) => run.split("万").map(kanjiBelowMan).join("万");

/** e-Gov writes 六百ボルト and 〇・一メガオーム: turn those into 600 and 0.1 so they compare with "600V" and "0.1MΩ". */
export function kanjiToArabic(s: string): string {
  return s.replace(/([〇一二三四五六七八九十百千万]+)(?:・([〇一二三四五六七八九]+))?/g, (_, int: string, frac?: string) =>
    `${kanjiRunToNumber(int)}${frac ? "." + [...frac].map((c) => KANJI_DIGITS.indexOf(c)).join("") : ""}`,
  );
}

const plain = (s: string) => kanjiToArabic(s.normalize("NFKC")).replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

/** The numbers in `text` that do not appear (as whole numbers) anywhere in `source`. */
export function numbersMissing(text: string, source: string): string[] {
  const src = plain(source);
  const nums = plain(text).match(/\d+(?:\.\d+)*/g) ?? []; // 1.5 and section numbers like 2.2.3
  return [...new Set(nums)].filter((n) => !new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?![\\d]|\\.\\d)`).test(src));
}

export const lawLabel = (l: Law) => `${l.short} ${l.article}【${l.heading}】`;

// --- callables (no Claude involved) ---
export async function listLaws() {
  return { laws: LAWS.map((l) => ({ id: l.id, short: l.short, article: l.article, heading: l.heading, summary: l.summary, keywords: l.keywords })) };
}

// Tables and formulas came out of the PDF as loose text; the numbers of 146-1表・146-2表 did not come out at all.
const TABLE_NOTES: Record<string, string> = {
  "kaishaku-146": "146-1表・146-2表の許容電流の数値は、元の PDF から文字として取り出せなかったため載っていません。数値は出典の原文で確かめてください。",
  "kaishaku-17": "17-1表・17-2表の式は、PDF から取り出した文字のため崩れています。出典の原文で確かめてください。",
  "kaishaku-149": "149-1表〜149-3表は、PDF から取り出した文字のため並びが崩れています。出典の原文で確かめてください。",
};

export async function getLaw(data: Record<string, unknown>) {
  const l = typeof data.id === "string" ? getLawById(data.id) : undefined;
  if (!l) return { law: null };
  return { law: { ...l, keywords: undefined, note: TABLE_NOTES[l.id] ?? null } };
}
