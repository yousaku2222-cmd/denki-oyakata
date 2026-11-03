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

// Words that only look like numbers (十分 = enough, 一般 = general …) stay words.
const NOT_NUMBERS = /十分|一般|一部|一つ|一体|一緒|一番|一方|一定|一連|一括|一時|一旦|一応|一切|同一|統一|唯一|万一|万全|千葉|一度に|もう一度|一度も/g;
// A kanji number counts only before a unit or counter (六百ボルト, 二箇所, 三以上), after 第 (第一種) or with a decimal part (〇・一).
const UNIT_AFTER = /^(?:ボルト|キロボルト|メガオーム|オーム|アンペア|ミリメートル|センチメートル|メートル|キロメートル|平方|ミリ|センチ|キロワット|ワット|キロ|メガ|ヘルツ|パーセント|割|円|億|箇所|か所|カ所|ケ所|条|項|号|種|年|月|日|時間|分間|秒|倍|本|回|個|枚|台|人|度|℃|以上|以下|未満|を超え|分の)/;
const KANJI_NUMBER = /(第)?([〇一二三四五六七八九十百千万]+)(?:・([〇一二三四五六七八九]+))?/g;

/** e-Gov writes 六百ボルト and 〇・一メガオーム: turn those into 600 and 0.1 so they compare with "600V" and "0.1MΩ". */
export function kanjiToArabic(s: string): string {
  const kept: string[] = [];
  const masked = s.replace(NOT_NUMBERS, (w) => `\u0000${kept.push(w) - 1}\u0000`);
  return masked
    .replace(KANJI_NUMBER, (all: string, dai: string | undefined, int: string, frac: string | undefined, at: number, whole: string) => {
      // a number only after 第, with a decimal part, or before a unit or counter; otherwise a word
      if (!dai && frac === undefined && !UNIT_AFTER.test(whole.slice(at + all.length))) return all;
      return `${dai ?? ""}${kanjiRunToNumber(int)}${frac ? "." + [...frac].map((c) => KANJI_DIGITS.indexOf(c)).join("") : ""}`;
    })
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
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
