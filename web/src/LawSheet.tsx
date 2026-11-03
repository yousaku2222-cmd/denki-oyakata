import { useEffect, useState } from "react";
import { call } from "./firebase";

export interface LawRef {
  id: string;
  short: string;
  article: string;
  heading: string;
  lawName?: string;
  edition?: string;
  sourceUrl?: string;
}
interface LawFull extends Required<LawRef> {
  text: string;
  note: string | null; // where tables of the PDF did not come out cleanly
  summary: string;
  plain?: { points: string[]; words: { term: string; plain: string }[] }; // the gist for a beginner (scripts/laws/plain.mjs)
  scenes: string[];
}

export const lawTitle = (l: Pick<LawRef, "short" | "article" | "heading">) => `${l.short} ${l.article}【${l.heading}】`;

/** Full original text of one article, with the cited part highlighted. */
export function LawSheet({ id, highlight, onClose }: { id: string; highlight?: string; onClose: () => void }) {
  const [law, setLaw] = useState<LawFull | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    call<{ law: LawFull | null }>("getLaw", { id })
      .then((r) => (r.law ? setLaw(r.law) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [id]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="条文">
        <button className="link sheet-close" onClick={onClose}>
          ✕ 閉じる
        </button>
        {failed && <p className="hint error">条文を読み込めませんでした。</p>}
        {!law && !failed && <p className="hint">読み込み中…</p>}
        {law && (
          <>
            <p className="law-src">⚖️ {law.lawName}</p>
            <h1 className="screen-title">
              {law.article}【{law.heading}】
            </h1>
            <p className="hint">
              {law.edition}・
              <a href={law.sourceUrl} target="_blank" rel="noreferrer">
                出典
              </a>
            </p>
            <div className="law-summary">
              <span>かんたんに言うと（AIの要約）</span>
              {law.plain?.points.length ? (
                <>
                  <ul>
                    {law.plain.points.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  {law.plain.words.length > 0 && (
                    <p className="law-words">
                      {law.plain.words.map((w) => (
                        <span key={w.term}>
                          <strong>{w.term}</strong>：{w.plain}
                        </span>
                      ))}
                    </p>
                  )}
                  <details>
                    <summary>くわしい要約</summary>
                    <p>{law.summary}</p>
                  </details>
                </>
              ) : (
                <p>{law.summary}</p>
              )}
            </div>
            <span className="field-label">原文</span>
            {law.note && <p className="hint">※ {law.note}</p>}
            <pre className="law-text">{highlightQuote(law.text, highlight)}</pre>
          </>
        )}
      </section>
    </div>
  );
}

// PDF text has line breaks in the middle of sentences, so match the quote ignoring spaces and breaks.
function highlightQuote(text: string, quote?: string) {
  if (!quote) return text;
  const want = quote.replace(/\s/g, "");
  const idx: number[] = []; // positions of non-space characters in text
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    if (!/[\s｜|]/.test(text[i])) {
      idx.push(i);
      flat += text[i];
    }
  }
  const at = flat.indexOf(want);
  if (at < 0 || !want) return text;
  const start = idx[at];
  const end = idx[at + want.length - 1] + 1;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
