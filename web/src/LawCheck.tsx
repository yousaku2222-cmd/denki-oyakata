import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, errorText } from "./firebase";

// 親方のカードを、公開する前に条文と照らし合わせる（functions/src/lawcheck.ts の checkCard）。
// AI が照らし、引用はプログラムが原文と確かめてある。⚠️ と 🔍 の文は、公開しても若手には出さない（親方のカードには残る）。
// 照らしていないカード（照らした後に文を直したカード）は公開できない（サーバーも拒む）。

export const CHECK_FIELDS = ["title", "scene", "body", "reason", "caution"] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];
export type CheckFields = Record<CheckField, string>;

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
  legal?: boolean; // against a law (else 標準仕様書, which is not law); a check from before: law
}
export interface LawCheckResult {
  checkedAt: number | null;
  sentences: { field: CheckField; text: string }[];
  items: CheckItem[];
  lawCount?: number;
  mode?: "claude" | "dummy";
}

// ⚠️ first: what the veteran has to look at comes before what agrees
const ORDER: Verdict[] = ["differs", "unsure", "stricter", "same"];
const MARK: Record<Verdict, { icon: string; label: string }> = {
  differs: { icon: "⚠️", label: "条文と違うかもしれない" },
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
const ADVICE: Partial<Record<Verdict, string>> = {
  differs: "AIの判断では条文と違うようです。AIが誤っている可能性もあります。その時は言い回しを変えて、もう一度照らしてください。",
  unsure: "条文と確かめられませんでした。言い回しを変えて、もう一度照らしてください。",
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

/** Whether the card is the checked one with some sentences taken out (else the check is out of date). */
function isChecked(r: LawCheckResult, f: CheckFields): boolean {
  if (!r.checkedAt || !r.sentences.length) return false;
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
 * runRef lets the publish button start a check.
 */
export function LawCheckPanel({
  cardId,
  fields,
  tags,
  initial,
  onEdit,
  onLeft,
  onState,
  runRef,
}: {
  cardId: string;
  fields: CheckFields;
  tags: string[];
  initial?: LawCheckResult | null; // the last check (myCard), shown again without asking Claude
  onEdit: (field: CheckField, value: string) => void;
  onLeft: (texts: string[]) => void;
  onState?: (s: LawCheckState) => void;
  runRef?: MutableRefObject<(() => void) | null>;
}) {
  const [result, setResult] = useState<LawCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // what ［この文を取り消す］ took out, to put back where it was
  const [taken, setTaken] = useState<Record<number, { field: CheckField; at: number }>>({});
  const latest = useRef({ fields, tags });
  latest.current = { fields, tags };

  const run = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await call<LawCheckResult>("checkCard", { cardId, edits: { ...latest.current.fields, tags: latest.current.tags } });
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
    if (initial?.checkedAt && isChecked(initial, latest.current.fields)) setResult(initial);
    else void run();
  }, [cardId, initial, run]);

  const items = useMemo(
    () => [...(result?.items ?? [])].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.n - b.n),
    [result],
  );
  const left = items.filter((it) => held(it) && onCard(it, fields)).map((it) => it.text);
  const leftKey = JSON.stringify(left);
  useEffect(() => onLeft(JSON.parse(leftKey) as string[]), [leftKey, onLeft]);

  const stale = !!result && result.sentences.length > 0 && !isChecked(result, fields);
  const checked = !!result && isChecked(result, fields);
  const failed = !!err;
  useEffect(() => onState?.({ checked, busy, failed }), [checked, busy, failed, onState]);

  function takeOut(it: CheckItem) {
    const now = fields[it.field];
    const at = now.indexOf(it.text);
    if (at < 0) return;
    onEdit(it.field, now.slice(0, at) + now.slice(at + it.text.length));
    setTaken({ ...taken, [it.n]: { field: it.field, at } });
  }
  function putBack(it: CheckItem) {
    const t = taken[it.n];
    if (!t) return;
    const now = fields[t.field];
    const at = Math.min(t.at, now.length);
    onEdit(t.field, now.slice(0, at) + it.text + now.slice(at));
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
                <p className="law-check-text">「{it.text}」</p>
                {it.note && <p className="law-check-note">{it.note}</p>}
                {(spec(it) ? SPEC_ADVICE : ADVICE)[it.verdict] && <p className="law-check-note">{(spec(it) ? SPEC_ADVICE : ADVICE)[it.verdict]}</p>}
                {it.quote && (
                  <p className="law-check-quote">
                    — {it.label}「{it.quote}」
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
                  ) : emptied ? (
                    <p className="hint">この欄は空にできません。言い回しを変えてから［もう一度照らす］を押してください。</p>
                  ) : (
                    <button type="button" className="secondary law-check-x" onClick={() => takeOut(it)}>
                      この文を取り消す
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {!busy && result && result.mode !== "dummy" && (
        <>
          {stale && <p className="hint">照らした後に文が直っています。公開する前に、もう一度照らしてください。</p>}
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
 * was checked: the sentences that may differ are not on the card young workers read at all.
 */
export function LawCheckBadge({ check }: { check?: { checkedAt: number } | null }) {
  if (!check) return null; // a card from before the check
  // the app holds only some of the articles: not a promise that the card is safe
  return <span className="law-badge">⚖️ アプリの条文と照らし済み</span>;
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
