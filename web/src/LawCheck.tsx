import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, errorText } from "./firebase";
import { LawSheet } from "./LawSheet";

// 親方のカードを、公開する前に条文と照らし合わせる（functions/src/lawcheck.ts の checkCard）。
// AI が照らし、引用はプログラムが原文と確かめてある。⚠️ と 🔍 の文は、公開しても若手には出さない（親方のカードには残る）。
// 照らしていないカード（照らした後に文を直したカード）は公開できない（サーバーも拒む）。
// 「標準語では」（plain）と言葉の意味（terms、「言葉：意味」を1文）も照らす。探す時の言葉（tags）は照らさないが、
// 照らした後に変えたら照らし直す。

export const CHECK_FIELDS = ["title", "scene", "body", "reason", "caution", "plain", "terms"] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];
/** The card's words as checked: terms is one 「言葉：意味」 a line (functions/src/lawcheck.ts termsText). */
export type CheckFields = Record<CheckField, string>;
// what the AI wrote for young workers, named on the list so the veteran knows where the sentence is
const FIELD_NAME: Partial<Record<CheckField, string>> = { plain: "標準語では", terms: "言葉の意味" };

type Term = { word: string; meaning: string };
/** The card's words on the edit screen (the draft as the server keeps it). */
export type CardWords = { title: string; scene: string; body: string; reason: string; caution: string; plain?: string; terms?: Term[] };
/** A word and its meaning as one sentence of the check (the same as functions/src/lawcheck.ts termLine). */
export const termLine = (t: Term) => `${t.word.trim()}：${t.meaning.trim().replace(/\s+/g, " ")}`;
/**
 * The card's words as the server checks them: the meanings it keeps (functions/src/interview.ts fitTerms: only words
 * written on the card, once each), one a line.
 */
export function checkFieldsOf(d: CardWords): CheckFields {
  const text = [d.title, d.scene, d.body, d.reason, d.caution].join("\n");
  const seen = new Set<string>();
  const terms = (d.terms ?? [])
    .map((t) => ({ word: t.word.trim(), meaning: t.meaning.trim() }))
    .filter((t) => {
      if (!t.word || !t.meaning || t.word === t.meaning || t.word.length > 20 || !text.includes(t.word) || seen.has(t.word)) return false;
      seen.add(t.word);
      return true;
    })
    .slice(0, 8);
  return { title: d.title, scene: d.scene, body: d.body, reason: d.reason, caution: d.caution, plain: (d.plain ?? "").trim(), terms: terms.map(termLine).join("\n") };
}
/** The meanings back from the terms field after a sentence was taken out or put back (the rest kept as they were). */
export function termsFrom(text: string, before: Term[]): Term[] {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line) => {
      const was = before.find((t) => termLine(t) === line);
      if (was) return was;
      const at = line.indexOf("：");
      return { word: line.slice(0, at), meaning: line.slice(at + 1) };
    })
    .filter((t) => t.word && t.meaning);
}
/** The search words as compared with the checked ones (the same as functions/src/lawcheck.ts tagsKey). */
const tagsKey = (tags: string[]) => JSON.stringify([...new Set(tags.map((x) => x.trim()).filter(Boolean))].sort());

type Verdict = "same" | "stricter" | "differs" | "unsure";
interface CheckItem {
  n: number;
  field: CheckField;
  text: string;
  verdict: Verdict;
  lawId: string;
  label: string;
  quote: string;
  note: string;
  part?: string; // differs: the words that differ (marked in the sentence)
  fix?: string; // differs: a way to say it that agrees with the article (offered, used only on a press)
  legal?: boolean; // against a law (else 標準仕様書, which is not law); a check from before: law
}
export interface LawCheckResult {
  checkedAt: number | null;
  sentences: { field: CheckField; text: string }[];
  items: CheckItem[];
  tags?: string[] | null; // the search words it was checked with (a check from before they were kept: none)
  lawCount?: number;
  mode?: "claude" | "dummy";
}

// ⚠️ first: what the veteran has to look at comes before what agrees
const ORDER: Verdict[] = ["differs", "unsure", "stricter", "same"];
const MARK: Record<Verdict, { icon: string; label: string }> = {
  differs: { icon: "⚠️", label: "条文と違うかもしれない所があります" },
  unsure: { icon: "🔍", label: "要確認（条文の引用が確かめられませんでした）" },
  stricter: { icon: "🟦", label: "条文より厳しい、会社の決まり" },
  same: { icon: "✅", label: "条文と同じ" },
};
const REQUIRED: CheckField[] = ["title", "body"]; // the card cannot be published with these empty
// the sentences young workers never see: ⚠️ / 🔍 against a law (functions/src/lawcheck.ts isHeld)
const HIDDEN: Verdict[] = ["differs", "unsure"];
const held = (it: CheckItem) => HIDDEN.includes(it.verdict) && it.legal !== false;
const spec = (it: CheckItem) => it.legal === false && HIDDEN.includes(it.verdict);
// against 標準仕様書 (not law): the sentence still reaches young workers
const SPEC_ADVICE: Partial<Record<Verdict, string>> = {
  differs: "公共工事の仕様書とは違うやり方のようです（法令ではありません）。若手にも表示し、「公共工事の仕様書とは違うやり方です（民間の現場では会社のやり方のこともあります）」と添えます。",
  unsure: "仕様書と確かめられませんでした（法令ではないので、若手にも表示します）。",
};
const HELD: Partial<Record<Verdict, string>> = {
  differs: "この文は条文と違うため、若手には表示していません。",
  unsure: "この文は条文と確かめられないため、若手には表示していません。",
};

/** Where the check stands, for the publish button: only a card checked as it is now can go out. */
export interface LawCheckState {
  checked: boolean;
  busy: boolean;
  failed: boolean;
}

// the same as the server (laws.ts normalizeForQuote): spaces and line breaks do not count
const norm = (s: string) => s.normalize("NFKC").replace(/[\s｜|]/g, "");

/** Whether the card is the checked one with some sentences taken out, and the same search words (else the check is out of date). */
function isChecked(r: LawCheckResult, f: CheckFields, tags: string[]): boolean {
  if (!r.checkedAt || !r.sentences.length || !r.tags || tagsKey(r.tags) !== tagsKey(tags)) return false;
  return CHECK_FIELDS.every((field) => {
    const now = norm(f[field]);
    let at = 0;
    for (const s of r.sentences) {
      if (s.field !== field) continue;
      const t = norm(s.text);
      if (now.startsWith(t, at)) at += t.length;
    }
    return at === now.length;
  });
}

const onCard = (it: CheckItem, f: CheckFields) => norm(f[it.field]).includes(norm(it.text));

/**
 * The check's box on the edit screen. onLeft tells the screen which ⚠️ / 🔍 sentences are still on the card (young
 * workers will not see them: asked once more before publishing), onState whether the card can be published, and
 * runRef lets the publish button start a check. onEdit gets the card's words with a sentence taken out or put back.
 */
export function LawCheckPanel({
  cardId,
  card,
  tags,
  initial,
  onEdit,
  onLeft,
  onState,
  runRef,
  onRewrite,
}: {
  cardId: string;
  card: CardWords;
  tags: string[];
  initial?: LawCheckResult | null; // the last check (myCard), shown again without asking Claude
  onEdit: (patch: Partial<CardWords>) => void;
  onLeft: (texts: string[]) => void;
  onState?: (s: LawCheckState) => void;
  runRef?: MutableRefObject<(() => void) | null>;
  onRewrite?: (field: CheckField) => void; // 自分で書き直す: the screen shows 「もう一度照らす」 by that field
}) {
  const [result, setResult] = useState<LawCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // what ［この文を取り消す］ took out, to put back where it was
  const [taken, setTaken] = useState<Record<number, { field: CheckField; at: number }>>({});
  const fields = useMemo(() => checkFieldsOf(card), [card]);
  const latest = useRef({ card, fields, tags });
  latest.current = { card, fields, tags };

  const run = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await call<LawCheckResult>("checkCard", { cardId, edits: { ...latest.current.card, tags: latest.current.tags } });
      setResult(r);
      setTaken({});
    } catch (e) {
      setErr(errorText(e, "照らし合わせに失敗しました。"));
    } finally {
      setBusy(false);
    }
  }, [cardId]);
  useEffect(() => {
    if (runRef) runRef.current = () => void run();
  }, [runRef, run]);

  // once when the card is opened: the last check if the card is still as it was, otherwise a new one
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !cardId) return;
    started.current = true;
    if (initial?.checkedAt && isChecked(initial, latest.current.fields, latest.current.tags)) setResult(initial);
    else void run();
  }, [cardId, initial, run]);

  const items = useMemo(
    () => [...(result?.items ?? [])].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.n - b.n),
    [result],
  );
  const left = items.filter((it) => held(it) && onCard(it, fields)).map((it) => it.text);
  const leftKey = JSON.stringify(left);
  useEffect(() => onLeft(JSON.parse(leftKey) as string[]), [leftKey, onLeft]);

  const runAfterEdit = useRef(false);
  useEffect(() => {
    if (!runAfterEdit.current) return;
    runAfterEdit.current = false;
    void run();
  }, [fields, run]);

  const stale = !!result && result.sentences.length > 0 && !isChecked(result, fields, tags);
  const checked = !!result && isChecked(result, fields, tags);
  const failed = !!err;
  useEffect(() => onState?.({ checked, busy, failed }), [checked, busy, failed, onState]);

  const takenTerms = useRef<Term[]>([]); // meanings taken out, so one put back is the same word and meaning
  // a meaning goes back into the list of words, the other fields are text
  const edit = (field: CheckField, value: string) => onEdit(field === "terms" ? { terms: termsFrom(value, [...(card.terms ?? []), ...takenTerms.current]) } : { [field]: value });
  function takeOut(it: CheckItem) {
    const now = fields[it.field];
    const at = now.indexOf(it.text);
    if (at < 0) return;
    if (it.field === "terms") takenTerms.current.push(...(card.terms ?? []).filter((t) => termLine(t) === it.text));
    edit(it.field, now.slice(0, at) + now.slice(at + it.text.length));
    setTaken({ ...taken, [it.n]: { field: it.field, at } });
  }
  function applyFix(it: CheckItem) {
    const now = fields[it.field];
    const at = now.indexOf(it.text);
    if (at < 0 || !it.fix) return;
    runAfterEdit.current = true;
    edit(it.field, now.slice(0, at) + it.fix + now.slice(at + it.text.length));
  }
  function rewrite(it: CheckItem) {
    onRewrite?.(it.field);
    const box = document.querySelector<HTMLTextAreaElement>(`[data-field="${it.field}"]`);
    if (!box) {
      // 標準語では / 言葉の意味 have their own box
      document.querySelector(".field-words")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    box.focus({ preventScroll: true });
    const at = box.value.indexOf(it.text);
    if (at >= 0) box.setSelectionRange(at, at + it.text.length);
  }
  function removeSentence(it: CheckItem) {
    if (!window.confirm("この文を消すと、この知恵は若手に届かなくなります。消しますか？")) return;
    takeOut(it);
  }
  function putBack(it: CheckItem) {
    const t = taken[it.n];
    if (!t) return;
    const now = fields[t.field];
    const at = Math.min(t.at, now.length);
    // a taken-out meaning is its own line again
    edit(t.field, t.field === "terms" ? [now.slice(0, at), it.text, now.slice(at)].map((x) => x.trim()).filter(Boolean).join("\n") : now.slice(0, at) + it.text + now.slice(at));
    const rest = { ...taken };
    delete rest[it.n];
    setTaken(rest);
  }

  return (
    <section className="law-check" aria-live="polite">
      <h2 className="law-check-head">⚖️ 条文との照らし合わせ</h2>
      <p className="law-check-sub">AIが照らし、引用はプログラムが原文と確かめ済み。決めるのは親方です。</p>
      {busy ? (
        <p className="law-check-busy">条文と照らしています…（10秒ほど）</p>
      ) : err ? (
        <p className="hint error">
          照らし合わせに失敗しました。{" "}
          <button type="button" className="link" onClick={run}>
            もう一度
          </button>
        </p>
      ) : result?.mode === "dummy" ? (
        <p className="hint">（いまは照らし合わせが使えません。公開はこのままできます）</p>
      ) : result && !items.length ? (
        <p className="hint">関係する条文が出てくる文はありませんでした（現場のコツの話です）。</p>
      ) : null}

      {!busy && items.some((it) => HIDDEN.includes(it.verdict)) && <p className="law-check-sub">AIの判断なので、間違っていることもあります。決めるのは親方です。</p>}
      {!busy && items.length > 0 && (
        <ul className="law-check-list">
          {items.map((it) => {
            const out = !onCard(it, fields);
            const emptied = REQUIRED.includes(it.field) && !norm(fields[it.field].replace(it.text, "")).replace(/[。！？!?、]/g, "");
            return (
              <li key={it.n} className={`law-check-item ${it.verdict} ${out ? "out" : ""}`}>
                <p className="law-check-mark">
                  {MARK[it.verdict].icon} {spec(it) ? (it.verdict === "differs" ? "公共工事の仕様書と違うかもしれない" : "要確認（仕様書の引用が確かめられませんでした）") : MARK[it.verdict].label}
                </p>
                <p className="law-check-text">
                  {HIDDEN.includes(it.verdict) && <span className="law-check-k">あなたの文：</span>}
                  {FIELD_NAME[it.field] && <span className="src-meta">（{FIELD_NAME[it.field]}）</span>}
                  {it.part && it.text.includes(it.part) ? (
                    <>
                      {it.text.slice(0, it.text.indexOf(it.part))}
                      <mark className="law-check-part">{it.part}</mark>
                      {it.text.slice(it.text.indexOf(it.part) + it.part.length)}
                    </>
                  ) : (
                    <>「{it.text}」</>
                  )}
                </p>
                {it.note && (
                  <p className="law-check-note">
                    <span className="law-check-k">条文では：</span>
                    {it.note.replace(/^条文では、?/, "")}
                  </p>
                )}
                {spec(it) && SPEC_ADVICE[it.verdict] && <p className="law-check-note">{SPEC_ADVICE[it.verdict]}</p>}
                {it.quote && (
                  <p className="law-check-quote">
                    — {it.label}「{it.quote}」
                  </p>
                )}
                {it.fix && !out && (
                  <p className="law-check-fix">
                    <span className="law-check-k">直すなら（案）：</span>
                    {it.fix}
                  </p>
                )}
                {held(it) && !out && <p className="law-check-held">{HELD[it.verdict]}</p>}
                {HIDDEN.includes(it.verdict) &&
                  (out ? (
                    taken[it.n] ? (
                      <p className="law-check-done">
                        取り消しました。{" "}
                        <button type="button" className="link" onClick={() => putBack(it)}>
                          元に戻す
                        </button>
                      </p>
                    ) : (
                      <p className="law-check-done">カードから消えています。</p>
                    )
                  ) : (
                    // fixing comes first and is the easy press; taking the sentence out is a small link, asked once
                    <div className="law-check-acts">
                      {it.fix && (
                        <button type="button" className="primary" onClick={() => applyFix(it)}>
                          この案に直す
                        </button>
                      )}
                      <button type="button" className="secondary" onClick={() => rewrite(it)}>
                        自分で書き直す
                      </button>
                      {emptied ? (
                        <p className="hint">この欄は空にできないので、消さずに書き直してください。</p>
                      ) : (
                        <button type="button" className="link" onClick={() => removeSentence(it)}>
                          この文を消す
                        </button>
                      )}
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {!busy && result && result.mode !== "dummy" && (
        <>
          {stale && <p className="hint">照らした後に、文・言葉の意味・標準語の言い換え・探す時の言葉のどれかが直っています。公開する前に、もう一度照らしてください。</p>}
          <button type="button" className="link law-check-again" onClick={run}>
            もう一度照らす
          </button>
        </>
      )}
    </section>
  );
}

/**
 * The card's small badge where young workers read it (an answer's 親方の知恵, the card opened from 探す). Only that it
 * was checked: the sentences that may differ are not on the card young workers read at all. With to (the id of the
 * card's ⚖️ 条文で確かめる box), a tap goes to that box.
 */
export function LawCheckBadge({ check, to }: { check?: { checkedAt: number } | null; to?: string }) {
  if (!check) return null; // a card from before the check
  // the app holds only some of the articles: not a promise that the card is safe
  if (!to) return <span className="law-badge">⚖️ アプリの条文と照らし済み</span>;
  return (
    <button type="button" className="law-badge law-badge-go" onClick={() => goToLinks(to)}>
      ⚖️ アプリの条文と照らし済み ›
    </button>
  );
}

/** One of the card's sentences that the check found the same as an article or stricter (functions/src/lawcheck.ts LawRefDoc). */
export interface LawLink {
  field: string;
  text: string;
  verdict: "same" | "stricter";
  lawId: string;
  label: string;
  quote: string; // checked against the article's original text by the program
}

/** The box, scrolled into view and lit for a moment (the badge's tap). */
function goToLinks(id: string) {
  const box = document.getElementById(id);
  if (!box) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  box.classList.remove("lit");
  void box.offsetWidth; // start the light again on a second tap
  box.classList.add("lit");
  setTimeout(() => box.classList.remove("lit"), 1500);
  box.focus({ preventScroll: true });
}

const LINKS_SHOWN = 3;
const LINK_KIND: Record<LawLink["verdict"], string> = { same: "✅ 条文と同じ", stricter: "🟦 条文より厳しい、会社の決まり" };

/**
 * Under a card young workers read, open from the start: the veteran's sentences that agree with an article, each a
 * tap away from the article's original text, sent to the quote and marked there. Only sentences young workers see
 * (the held-back ones are not on the card), and only quotes the program found in the original. from: whose card,
 * when the links of several cards are in one box (an answer).
 */
export function LawLinks({ id, links }: { id: string; links: (LawLink & { from?: string })[] }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<{ id: string; quote: string } | null>(null);
  if (!links.length) return null;
  const shown = all ? links : links.slice(0, LINKS_SHOWN);
  return (
    <section id={id} className="law-links" tabIndex={-1} aria-label="条文で確かめる">
      <p className="law-links-head">
        <strong>⚖️ 条文で確かめる</strong>
        <span>（アプリの条文と照らし済み）</span>
      </p>
      <p className="law-links-sub">親方の話のうち、条文と照らして合っていると分かった文です。押すと条文の原文の、その所が開きます。</p>
      <ul>
        {shown.map((l, i) => (
          <li key={`${l.lawId}-${i}`}>
            {l.from && <span className="law-links-from">🧰 {l.from}</span>}
            <p className="law-links-text">「{l.text}」</p>
            <div className="law-links-go">
              <span aria-hidden>→</span>
              <button type="button" className="cite-chip" onClick={() => setOpen({ id: l.lawId, quote: l.quote })}>
                📜 {l.label} ›
              </button>
            </div>
            <span className={`law-links-kind ${l.verdict}`}>{LINK_KIND[l.verdict]}</span>
          </li>
        ))}
      </ul>
      {links.length > LINKS_SHOWN && (
        <button type="button" className="link" onClick={() => setAll(!all)}>
          {all ? "▲ 閉じる" : `▼ ほかに${links.length - LINKS_SHOWN}件`}
        </button>
      )}
      {open && <LawSheet id={open.id} highlight={open.quote} onClose={() => setOpen(null)} />}
    </section>
  );
}

export const SPEC_NOTE = "公共工事の仕様書とは違うやり方です（民間の現場では会社のやり方のこともあります）";

/** Under a card young workers read: its sentences that differ from 公共建築工事標準仕様書 (not law), each with the note. */
export function SpecNote({ sentences }: { sentences?: (string | { text: string })[] }) {
  if (!sentences?.length) return null;
  return (
    <ul className="spec-note">
      {sentences.map((s, i) => (
        <li key={i}>
          📘「{typeof s === "string" ? s : s.text}」は、{SPEC_NOTE}
        </li>
      ))}
    </ul>
  );
}
