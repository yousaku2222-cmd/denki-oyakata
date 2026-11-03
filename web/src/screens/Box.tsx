import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { call, errorText } from "../firebase";
import { fmtDate } from "../components";
import type { Topic } from "./Talk";

interface Q {
  id: string;
  text: string;
  askerName: string;
  askerRole: string;
  hasPhoto: boolean;
  good: boolean;
  createdAt: number;
}

// When this device last looked at the box, so questions that came in since then are marked 新着.
const SEEN_KEY = "oyakata.boxSeen";
function lastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function markSeen(at: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // private window: nothing is marked new next time, which is fine
  }
}

// Read through Functions: a question carries its asker's device id and a photo (opened only when wanted).
export function Box({ onAnswer }: { onAnswer: (t: Topic) => void }) {
  const [items, setItems] = useState<Q[] | null>(null);
  const [more, setMore] = useState(0);
  const [err, setErr] = useState("");
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [seenBefore, setSeenBefore] = useState(lastSeen);

  const load = useCallback(() => {
    setErr("");
    call<{ questions: Q[]; more: number }>("openQuestions", {})
      .then((r) => {
        setItems(r.questions);
        setMore(r.more);
        // the marks stay for this visit; next time only newer questions are 新着
        const newest = Math.max(0, ...r.questions.map((q) => q.createdAt));
        if (newest > lastSeen()) markSeen(newest);
      })
      .catch((e) => setErr(errorText(e, "質問を読み込めませんでした。電波の良い所で、もう一度お試しください。")));
  }, []);
  useEffect(load, [load]);

  function good(q: Q) {
    setItems((list) => list?.map((x) => (x.id === q.id ? { ...x, good: true } : x)) ?? null);
    call("markGoodQuestion", { questionId: q.id }).catch((e) => {
      setItems((list) => list?.map((x) => (x.id === q.id ? { ...x, good: false } : x)) ?? null);
      setErr(errorText(e, "「いい質問」を送れませんでした。もう一度お試しください。"));
    });
  }

  function openPhoto(q: Q) {
    setPhotos((p) => ({ ...p, [q.id]: null }));
    call<{ photo: string | null }>("questionPhoto", { questionId: q.id })
      .then((r) => setPhotos((p) => ({ ...p, [q.id]: r.photo ?? "" })))
      .catch(() => setPhotos((p) => ({ ...p, [q.id]: "" })));
  }

  return (
    <section className="screen">
      <h1 className="screen-title">答えてほしい質問</h1>
      <p className="hint">若手が答えを見つけられなかった質問です。押すと、そのまま話して答えられます。</p>
      {!!items?.length && (
        <p className="box-count">
          📮 {items.length}件の質問が届いています
          {items.some((q) => q.createdAt > seenBefore) && <span className="new-chip">新着 {items.filter((q) => q.createdAt > seenBefore).length}件</span>}
        </p>
      )}
      <button
        className="link"
        onClick={() => {
          setSeenBefore(lastSeen());
          load();
        }}
      >
        ↻ 新しい質問を見る
      </button>
      {err && <p className="hint error">{err}</p>}
      {items === null && !err && <p className="hint">読み込み中…</p>}
      {items?.length === 0 && <p className="empty">いまは質問がありません。</p>}
      {items?.map((q, i) => (
        <motion.div
          key={q.id}
          className={`qcard ${q.createdAt > seenBefore ? "is-new" : ""}`}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i, 6) * 0.12, duration: 0.4, ease: "easeOut" }}
        >
          {q.createdAt > seenBefore && <span className="new-chip">新着</span>}
          {q.hasPhoto &&
            (q.id in photos ? (
              photos[q.id] === null ? (
                <p className="hint">写真を読み込み中…</p>
              ) : photos[q.id] ? (
                <img className="photo-preview" src={photos[q.id]!} alt="若手が撮った写真" />
              ) : (
                <p className="hint">写真はありません（または読み込めませんでした）。</p>
              )
            ) : (
              <button className="link" onClick={() => openPhoto(q)}>
                📷 写真を見る
              </button>
            ))}
          <p className="qtext">{q.text}</p>
          <p className="src-meta">
            {q.askerName}さん{q.askerRole === "veteran" ? "（ベテラン）" : ""}・{fmtDate(q.createdAt)}
          </p>
          <div className="row">
            <button className="primary" onClick={() => onAnswer({ questionId: q.id, text: q.text, askerName: q.askerName })}>
              🎤 話して答える
            </button>
            <button className={`secondary ${q.good ? "done" : ""}`} disabled={q.good} onClick={() => good(q)}>
              {q.good ? "⭐ いい質問！" : "⭐ いい質問"}
            </button>
          </div>
        </motion.div>
      ))}
      {more > 0 && <p className="hint">ほかに古い質問が {more} 件あります（新しい順に50件まで表示）。</p>}
    </section>
  );
}
