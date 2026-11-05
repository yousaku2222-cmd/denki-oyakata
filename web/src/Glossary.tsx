import { Fragment, useEffect, useState, type ReactNode } from "react";
import { call } from "./firebase";
import { LawSheet } from "./LawSheet";
import { Sheet } from "./Sheet";

export type Meaning =
  | {
      plain: string;
      kind: "law";
      lawId: string;
      label: string; // 電技解釈 第29条
    }
  // a veteran's own word on a card (dialect, the company's name for a thing): its meaning was written by the AI
  | { plain: string; kind: "field" };
export interface Term {
  term: string;
  meanings: Meaning[];
}

// one fetch per page load: the list only changes with a deploy
let loading: Promise<Term[]> | null = null;
const fetchTerms = () =>
  (loading ??= call<{ terms: Term[] }>("listGlossary", {})
    .then((r) => r.terms)
    .catch(() => {
      loading = null;
      return [];
    }));

/** What is matched in a sentence (as written, so the answer is shown unchanged): 「1線地絡電流（Ig）」 without its note. */
const keyOf = (term: string) => term.replace(/[（(][^）)]*[）)]/g, "").trim();

export function useGlossary() {
  const [terms, setTerms] = useState<Term[]>([]);
  useEffect(() => {
    let live = true;
    fetchTerms().then((t) => live && setTerms(t));
    return () => {
      live = false;
    };
  }, []);
  return terms;
}

export interface Mark {
  at: number;
  end: number;
  term: Term;
}

/** A card's own words (CardDoc.terms on the server) as terms to underline. Older cards have none. */
export interface FieldWord {
  word: string;
  meaning: string;
}
export const fieldTerms = (words: FieldWord[] | undefined): Term[] => (words ?? []).map((w) => ({ term: w.word, meanings: [{ plain: w.meaning, kind: "field" }] }));

/**
 * Where each term is read in `text`, longest first so 漏電遮断器 wins over 遮断器: a shorter term inside a longer one
 * (接触防護措置 in 簡易接触防護措置) is part of that word, not a mention of its own, even when the longer one is not
 * underlined there. The first place of each term outside the longer ones.
 * `first`: the card's own words, placed before any of `terms` (the veteran's meaning of a word wins where they overlap).
 */
export function termsIn(text: string, terms: Term[], first: Term[] = []): Mark[] {
  const taken: { at: number; end: number }[] = [];
  const marks: Mark[] = [];
  const byLength = (list: Term[]) => list.filter((x) => keyOf(x.term).length >= 2 && text.includes(keyOf(x.term))).sort((a, b) => keyOf(b.term).length - keyOf(a.term).length);
  const sorted = [...byLength(first), ...byLength(terms)];
  for (const term of sorted) {
    const k = keyOf(term.term);
    const free: { at: number; end: number }[] = [];
    for (let at = text.indexOf(k); at >= 0; at = text.indexOf(k, at + 1)) {
      if (!taken.some((s) => at < s.end && at + k.length > s.at)) free.push({ at, end: at + k.length });
    }
    if (!free.length) continue;
    taken.push(...free);
    marks.push({ ...free[0], term });
  }
  return marks.sort((a, b) => a.at - b.at);
}

/**
 * For each text in reading order, the places to underline there: each term only where it is first read, so a long
 * answer is not covered in lines. `local[i]`: words that belong to text i only (a card's own words, in its sentences).
 */
export function firstMentions(texts: string[], terms: Term[], local: Term[][] = []): Mark[][] {
  const seen = new Set<string>();
  return texts.map((text, i) =>
    termsIn(text, terms, local[i]).filter((m) => {
      const key = `${m.term.meanings[0]?.kind}|${m.term.term}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

/**
 * The meanings of a term with those from the given articles first: an answer that quotes 第29条 explains its words
 * the way 第29条 does.
 */
export const meaningsFor = (term: Term, lawIds: string[]): Term => ({
  ...term,
  meanings: [...term.meanings].sort((a, b) => Number(b.kind === "law" && lawIds.includes(b.lawId)) - Number(a.kind === "law" && lawIds.includes(a.lawId))),
});

/** `text` with `marks` underlined; a tap opens the meaning. */
export function Glossed({ text, marks, onOpen }: { text: string; marks: Mark[]; onOpen: (t: Term) => void }) {
  if (!marks.length) return <>{text}</>;
  const spans = [...marks].sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const s of spans) {
    out.push(text.slice(pos, s.at));
    out.push(
      <button key={s.at} type="button" className="gloss" onClick={() => onOpen(s.term)}>
        {text.slice(s.at, s.end)}
      </button>,
    );
    pos = s.end;
  }
  out.push(text.slice(pos));
  return (
    <>
      {out.map((x, i) => (
        <Fragment key={i}>{x}</Fragment>
      ))}
    </>
  );
}

/** The meaning of one word, with where it came from and the way on to the article. */
export function GlossSheet({ term, onClose }: { term: Term; onClose: () => void }) {
  const [law, setLaw] = useState<string | null>(null);
  if (law) return <LawSheet id={law} onClose={() => setLaw(null)} />;
  return (
    <Sheet label="言葉の意味" onClose={onClose}>
      <h1 className="screen-title">📖 {term.term}</h1>
      <Meanings term={term} onLaw={setLaw} />
    </Sheet>
  );
}

/** The first meaning; the same word explained under other articles waits behind a tap. */
export function Meanings({ term, onLaw }: { term: Term; onLaw: (lawId: string) => void }) {
  const [first, ...more] = term.meanings;
  return (
    <>
      <MeaningRow m={first} onLaw={onLaw} />
      {more.length > 0 && (
        <details className="gloss-more">
          <summary>ほかの条文での説明（{more.length}件）</summary>
          {more.map((m) => (
            <MeaningRow key={(m.kind === "law" ? m.lawId : "") + m.plain} m={m} onLaw={onLaw} />
          ))}
        </details>
      )}
    </>
  );
}

function MeaningRow({ m, onLaw }: { m: Meaning; onLaw: (lawId: string) => void }) {
  if (m.kind === "field")
    return (
      <div className="gloss-meaning">
        <p>{m.plain}</p>
        <p className="src-meta">💬 現場の言葉（意味は AI が付けました。元は親方の言葉）</p>
      </div>
    );
  return (
    <div className="gloss-meaning">
      <p>{m.plain}</p>
      <p className="src-meta">💡 AIのかんたん説明（{m.label}より）</p>
      <button className="link" onClick={() => onLaw(m.lawId)}>
        ⚖️ 条文の全文を見る ›
      </button>
    </div>
  );
}

/**
 * A card's words as told, with its own words (dialect, the company's names) underlined where each is first read;
 * a tap shows the meaning. `texts` in reading order; render `sheet` once beside them.
 */
export function useCardWords(texts: string[], words: FieldWord[] | undefined) {
  const [open, setOpen] = useState<Term | null>(null);
  const local = fieldTerms(words);
  const marks = firstMentions(texts, [], texts.map(() => local));
  return {
    show: (i: number) => <Glossed text={texts[i]} marks={marks[i] ?? []} onOpen={setOpen} />,
    sheet: open && <GlossSheet term={open} onClose={() => setOpen(null)} />,
  };
}

/** Under a card told in strong dialect: the same in standard Japanese (the AI's, so it says so). Nothing when empty. */
export function PlainNote({ plain }: { plain?: string }) {
  if (!plain) return null;
  return (
    <p className="plain-note">
      <span className="plain-note-head">標準語では：</span>
      {plain}
      <span className="src-meta">（AI の言い換え。元は親方の言葉）</span>
    </p>
  );
}
