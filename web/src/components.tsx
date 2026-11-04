import { useEffect, useRef, type ReactNode } from "react";
import { useSpeech } from "./speech";
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
  category: string;
  location: string;
  authorName: string;
  showAuthorName: boolean;
  helpedCount: number;
  triggerAskerName: string | null;
  publishedAt: { toMillis(): number } | null;
}

export const SOURCE_LABEL: Record<Source, { icon: string; label: string }> = {
  law: { icon: ic("law"), label: "法令・基準" },
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
}) {
  const { value, onChange, paused } = props;
  // several final results can arrive before the next render: append to the latest text, not to this render's copy
  const latest = useRef(value);
  latest.current = value;
  const { listening, interim, error, start, stop } = useSpeech((t) => {
    latest.current = (latest.current ? latest.current + " " : "") + t;
    onChange(latest.current);
  });
  useEffect(() => {
    if (paused) stop();
  }, [paused, stop]);
  return (
    <div className="mic-input">
      <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={listening ? stop : start}>
        <span className="mic-icon" aria-hidden>
          {listening ? "■" : "🎤"}
        </span>
        {listening ? "止める" : props.micLabel}
      </button>
      {listening && <p className="hint live">聞いています… {interim}</p>}
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

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}
