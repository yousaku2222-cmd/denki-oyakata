import { useEffect, useRef, useState, type ReactNode } from "react";
import { unlockSay, useSpeech } from "./speech";
import { ic } from "./Icon";

export type Source = "law" | "wisdom" | "general";
export interface Sentence {
  text: string;
  source: Source;
  cardId?: string;
  lawId?: string;
  quote?: string;
  verified?: boolean;
}
export interface Card {
  id: string;
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  tags: string[];
  terms?: { word: string; meaning: string }[]; // the veteran's own words with a meaning by the AI (older cards: none)
  plain?: string; // the card in standard Japanese, only when told in strong dialect
  category: string;
  location: string;
  authorName: string;
  showAuthorName: boolean;
  helpedCount: number;
  triggerAskerName: string | null;
  publishedAt: { toMillis(): number } | null;
  // checked against the articles before it was published (functions/src/lawcheck.ts); older cards: none
  lawCheck?: { checkedAt: number }; // only that it was checked: sentences that may differ from a law are never on the card
  specDiffers?: { field: string; text: string }[]; // sentences that differ from 標準仕様書 (not law): shown with a note
}

export const SOURCE_LABEL: Record<Source, { icon: string; label: string }> = {
  law: { icon: "⚖️", label: "法令・基準" },
  wisdom: { icon: ic("wisdom"), label: "親方の知恵" },
  general: { icon: ic("general"), label: "一般知識（要確認）" },
};

export const CATEGORY_LABEL: Record<string, string> = {
  piping: "配管",
  wiring: "配線",
  grounding: "接地",
  license: "資格",
  calc: "計算",
  safety: "安全",
  other: "その他",
};
export const LOCATION_LABEL: Record<string, string> = {
  ceiling: "天井",
  floor: "床下",
  outdoor: "屋外",
  panel: "盤まわり",
  other: "その他",
};

export const authorOf = (c: Pick<Card, "showAuthorName" | "authorName">) =>
  c.showAuthorName && c.authorName ? c.authorName : "社内のベテラン";

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Big mic button + text box. Speech is appended to the text. */
export function MicInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  micLabel: string;
  rows?: number;
  paused?: boolean; // the screen is hidden: stop listening, so words said elsewhere do not land here
  maxLength?: number; // the server's limit for this text
  onDone?: (text: string) => void; // one press ends speaking and sends what was said
  doneLabel?: string;
  onListening?: (on: boolean) => void; // the screen hides what would cut in while the mic is on
}) {
  const { value, onChange, paused, onListening } = props;
  // several final results can arrive before the next render: append to the latest text, not to this render's copy
  const latest = useRef(value);
  latest.current = value;
  // 「話し終わった」: the last words arrive after stop, so it is sent when listening has ended
  const sendAfter = useRef(false);
  const { listening, interim, error, start, stop } = useSpeech(
    (t) => {
      latest.current = (latest.current ? latest.current + " " : "") + t;
      onChange(latest.current);
    },
    () => {
      if (!sendAfter.current) return;
      sendAfter.current = false;
      if (latest.current.trim()) props.onDone?.(latest.current);
    },
  );
  const finish = () => {
    unlockSay(); // a tap: the reply that comes after the network can be read out
    sendAfter.current = true;
    stop();
  };
  useEffect(() => {
    if (paused) stop();
  }, [paused, stop]);
  useEffect(() => onListening?.(listening), [listening, onListening]);
  return (
    <div className="mic-input">
      <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={listening ? (props.onDone ? finish : stop) : start}>
        <span className="mic-icon" aria-hidden>
          {listening ? "■" : "🎤"}
        </span>
        {listening ? (props.onDone ? (props.doneLabel ?? "話し終わった（送る）") : "止める") : props.micLabel}
      </button>
      {listening && <p className="hint live">聞いています… {interim}</p>}
      {listening && props.onDone && (
        <button type="button" className="link" onClick={stop}>
          送らずに止める（直してから送る）
        </button>
      )}
      {error && <p className="hint error">{error}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        maxLength={props.maxLength}
      />
    </div>
  );
}

/** What sendToBox returns. needsConfirm: not sent, the veteran might not understand it (reason and a fixed wording). */
export interface BoxSent {
  questionId?: string;
  duplicate?: boolean;
  merged?: boolean;
  askers?: number;
  needsConfirm?: boolean;
  reason?: string;
  suggestion?: string;
}
/** A question the server held back, with the words that were sent. */
export interface BoxHeld {
  text: string;
  reason: string;
  suggestion: string;
}
export const heldOf = (r: BoxSent, text: string): BoxHeld | null => (r.needsConfirm ? { text, reason: r.reason ?? "", suggestion: r.suggestion ?? "" } : null);

/**
 * Before the box: the question might not get across to the veteran. Send the fixed words, send as is (confirmed: not
 * checked again), or rewrite. onRewrite: the screen's own input is on show, so it only closes this; without it the
 * words are fixed here and checked again.
 */
export function SendCheck({ held, sending, onSend, onRewrite }: { held: BoxHeld; sending: boolean; onSend: (text: string, confirmed: boolean, from: DOMRect) => void; onRewrite?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(held.text);
  const rect = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.getBoundingClientRect();
  return (
    <div className="send-check" role="alert">
      <p className="send-check-head">🤔 このままだと、親方に伝わりにくいかもしれません</p>
      <p className="send-check-q">「{held.text}」</p>
      <p className="send-check-why">理由：{held.reason}</p>
      {editing ? (
        <>
          <MicInput value={draft} onChange={setDraft} maxLength={500} micLabel="話して直す" placeholder="親方に聞きたいことを、もう一度" />
          <div className="row">
            <button className="primary" disabled={sending || !draft.trim()} onClick={(e) => onSend(draft.trim(), false, rect(e))}>
              📮 この文で送る
            </button>
            <button className="secondary" disabled={sending} onClick={() => setEditing(false)}>
              やめる
            </button>
          </div>
        </>
      ) : (
        <>
          {held.suggestion && (
            <div className="send-check-fix">
              <span className="src-meta">こう直しますか？</span>
              <p>{held.suggestion}</p>
            </div>
          )}
          <div className="send-check-actions">
            {held.suggestion && (
              <button className="primary" disabled={sending} onClick={(e) => onSend(held.suggestion, true, rect(e))}>
                直した文で送る
              </button>
            )}
            <button className={held.suggestion ? "secondary" : "primary"} disabled={sending} onClick={(e) => onSend(held.text, true, rect(e))}>
              このまま送る
            </button>
            <button className="secondary" disabled={sending} onClick={() => (onRewrite ? onRewrite() : setEditing(true))}>
              自分で書き直す
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}

/** Grey shapes where the list will be, so a slow signal does not look like an empty screen. */
export function Skeleton({ n = 3, tiles = false }: { n?: number; tiles?: boolean }) {
  return (
    <div className={tiles ? "calc-tiles" : "skeleton-list"} aria-label="読み込み中" role="status">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={tiles ? "skeleton skeleton-tile" : "skeleton skeleton-row"} />
      ))}
    </div>
  );
}

/** A list that could not be read says so (not 「ありません」) and can be read again. */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="load-failed" role="alert">
      <p className="hint error">{what}を読み込めませんでした。電波の良い所で、もう一度お試しください。</p>
      <button className="secondary" onClick={onRetry}>
        ↻ もう一度読み込む
      </button>
    </div>
  );
}
