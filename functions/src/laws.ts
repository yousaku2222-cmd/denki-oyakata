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
  plain?: { points: string[]; words: { term: string; plain: string }[] }; // かんたんに言うと (scripts/laws/plain.mjs)
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

// Words that only look like numbers (十分 = enough, 一般 = general …) stay words, unless they sit inside a
// real number (三十分 = 30 minutes, 十分の一 = 1/10, 一時間 = 1 hour).
const NOT_NUMBERS =
  /(?<![〇一二三四五六七八九十百千万\d])(?:十分(?!の[〇一二三四五六七八九十]|間(?!隔))|一般|一部|一つ|一体|一緒|一番|一方|一定|一連|一括|一時(?!間)|一旦|一応|一切|同一|統一|唯一|万一|万全|千葉|一度に|もう一度|一度も)/g;
// A kanji number counts only before a unit or counter (六百ボルト, 二箇所, 三以上, 三線, 二十A), after 第 (第一種),
// or with a decimal part (〇・一).
const UNIT_AFTER =
  /^(?:ボルト|キロボルト|メガオーム|オーム|アンペア|ミリメートル|センチメートル|メートル|キロメートル|平方|ミリ|センチ|キロワット|ワット|キロ|メガ|ヘルツ|パーセント|割|円|億|箇所|か所|カ所|ケ所|条|項|号|種|年|月|日|時間|時|分間|分|秒|倍|本|回|個|枚|台|人|度|℃|以上|以下|未満|を超え|分の|線|心|芯|つ|階|灯|極|口|路|[A-Za-zΩ%％])/;
const KANJI_NUMBER = /(第)?([〇一二三四五六七八九十百千万]+)(?:・([〇一二三四五六七八九]+))?/g;

/** e-Gov writes 六百ボルト and 〇・一メガオーム: turn those into 600 and 0.1 so they compare with "600V" and "0.1MΩ". */
export function kanjiToArabic(s: string): string {
  const kept: string[] = [];
  const masked = s.replace(NOT_NUMBERS, (w) => `\u0000${kept.push(w) - 1}\u0000`);
  return masked
    .replace(KANJI_NUMBER, (all: string, dai: string | undefined, int: string, frac: string | undefined, at: number, whole: string) => {
      if (!dai && frac === undefined && !UNIT_AFTER.test(whole.slice(at + all.length))) return all; // a word
      return `${dai ?? ""}${kanjiRunToNumber(int)}${frac ? "." + [...frac].map((c) => KANJI_DIGITS.indexOf(c)).join("") : ""}`;
    })
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
}

/** "5千万円", "4千5百万円": digits with 千・百・十 → 5000万円, 4500万円 (万 stays a word, as above). */
const mixedPlaces = (s: string) =>
  s.replace(/(?:\d+[千百十])+\d*/g, (m) => {
    let total = 0;
    for (const [, n, u] of m.matchAll(/(\d+)([千百十])/g)) total += Number(n) * { 千: 1000, 百: 100, 十: 10 }[u as "千" | "百" | "十"];
    const rest = m.match(/\d+$/);
    return String(total + (rest ? Number(rest[0]) : 0));
  });

const plain = (s: string) => kanjiToArabic(mixedPlaces(s.normalize("NFKC"))).replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

// "第2項第1号" / "4号" points at a place inside the article, not a value, and item numbers are not reliable
// numbers in the source (一 二 … at line starts): drop them from the sentence. Article numbers (第178条) stay and
// must appear in the source (the article's own number is passed with its text).
const REFERENCES = /第?\d+(?:項|号)/g;

/** The numbers in `text` that do not appear (as whole numbers) anywhere in `source`. */
export function numbersMissing(text: string, source: string): string[] {
  const src = plain(source);
  const nums = plain(text).replace(REFERENCES, "").match(/\d+(?:\.\d+)*/g) ?? []; // 1.5 and section numbers like 2.2.3
  return [...new Set(nums)].filter((n) => !new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?![\\d]|\\.\\d)`).test(src));
}

export const lawLabel = (l: Law) => `${l.short} ${l.article}【${l.heading}】`;

// --- callables (no Claude involved) ---
export async function listLaws() {
  // the list on 探す: the gist and a scene say what each article is for, before its number does
  return {
    laws: LAWS.map((l) => ({
      id: l.id,
      short: l.short,
      article: l.article,
      heading: l.heading,
      summary: l.summary,
      keywords: l.keywords,
      points: l.plain?.points ?? [],
      scenes: l.scenes.slice(0, 3),
    })),
  };
}

/**
 * The words a beginner may not know, with where each meaning comes from. Only the law summaries' words for now;
 * a word can have meanings from more than one source (`kind` leaves room for the veterans' own words).
 */
export async function listGlossary() {
  const byTerm = new Map<string, { term: string; meanings: { plain: string; kind: "law"; lawId: string; label: string }[] }>();
  for (const l of LAWS) {
    for (const w of l.plain?.words ?? []) {
      const term = w.term.trim();
      if (!term || !w.plain.trim()) continue;
      const entry = byTerm.get(term) ?? { term, meanings: [] };
      if (!entry.meanings.some((m) => m.plain === w.plain)) entry.meanings.push({ plain: w.plain, kind: "law", lawId: l.id, label: `${l.short} ${l.article}` });
      byTerm.set(term, entry);
    }
  }
  return { terms: [...byTerm.values()] };
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
