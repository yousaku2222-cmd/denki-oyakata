// Keyword search over wisdom cards. Japanese has no spaces, so we compare
// character bigrams. Good enough for a company-sized card set; the answer
// model only sees the top few cards.

export interface SearchableCard {
  id: string;
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  tags: string[];
}

const STOP = new Set(["です", "ます", "した", "ので", "って", "ても", "には", "ですか", "すか", "んで", "てる"]);

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。・,.!?！？「」（）()【】\[\]:：\/]/g, "");
}

export function bigrams(s: string): Set<string> {
  const n = normalize(s);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) {
    const g = n.slice(i, i + 2);
    if (!STOP.has(g)) out.add(g);
  }
  return out;
}

export function scoreCard(query: string, card: SearchableCard): number {
  const q = bigrams(query);
  if (q.size === 0) return 0;
  const weighted: [string, number][] = [
    [card.title, 3],
    [card.tags.join(" "), 3],
    [card.scene, 1.5],
    [card.body, 1],
    [card.reason, 1],
    [card.caution, 1],
  ];
  let hit = 0;
  for (const [text, w] of weighted) {
    const t = bigrams(text);
    let n = 0;
    for (const g of q) if (t.has(g)) n++;
    hit += (n / q.size) * w;
  }
  return hit;
}

export function searchCards<T extends SearchableCard>(query: string, cards: T[], limit = 5, min = 0.6): { card: T; score: number }[] {
  return cards
    .map((card) => ({ card, score: scoreCard(query, card) }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
