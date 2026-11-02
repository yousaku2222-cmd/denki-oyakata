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
export function quoteIsInOriginal(quote: string, lawText: string): boolean {
  const q = normalizeForQuote(quote).replace(/^[「『]|[」』]$/g, "");
  return q.length >= 8 && normalizeForQuote(lawText).includes(q);
}

export const lawLabel = (l: Law) => `${l.short} ${l.article}【${l.heading}】`;

// --- callables (no Claude involved) ---
export async function listLaws() {
  return { laws: LAWS.map((l) => ({ id: l.id, short: l.short, article: l.article, heading: l.heading, summary: l.summary, keywords: l.keywords })) };
}

export async function getLaw(data: Record<string, unknown>) {
  const l = typeof data.id === "string" ? getLawById(data.id) : undefined;
  if (!l) return { law: null };
  return { law: { ...l, keywords: undefined } };
}
