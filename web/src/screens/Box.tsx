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
  askers: number; // people who sent this same question
  followUp: { text: string; cardTitle: string | null } | null; // asked under an answer a veteran gave
  createdAt: number;
  lastAskedAt: number; // the first time, or when someone joined it
}

/** 新着 first, then the ones many people asked, then the rest; newest first inside each. */
function grouped(items: Q[], seenBefore: number) {
  const isNew = (q: Q) => q.lastAskedAt > seenBefore;
  const byAskers = (a: Q, b: Q) => b.askers - a.askers || b.lastAskedAt - a.lastAskedAt;
  return [
    { key: "new", head: (n: number) => `🆕 新着 ${n}件`, list: items.filter(isNew).sort(byAskers) },
    { key: "many", head: () => "👥 何人も聞いている質問", list: items.filter((q) => !isNew(q) && q.askers > 1).sort(byAskers) },
    { key: "rest", head: () => "そのほか", list: items.filter((q) => !isNew(q) && q.askers <= 1).sort((a, b) => b.lastAskedAt - a.lastAskedAt) },
  ].filter((g) => g.list.length);
}

/** A few stars spring out of the button when a veteran says いい質問 (the asker sees it on わたし). */
function StarBurst() {
  return (
    <span className="star-burst" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
            animate={{ x: Math.cos(a) * 46, y: Math.sin(a) * 30, opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            ⭐
          </motion.span>
        );
      })}
    </span>
  );
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
        const newest = Math.max(0, ...r.questions.map((q) => q.lastAskedAt));
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
      <p className="hint">若手が親方に聞きたい質問です。「話して答える」を押すと、そのまま話して答えられ、答えは知恵カードになります。「⭐ いい質問」を押すと、聞いた若手に届きます。</p>
      {!!items?.length && (
        <p className="box-count">
          📮 {items.length}件の質問が届いています
          {items.some((q) => q.lastAskedAt > seenBefore) && <span className="new-chip">新着 {items.filter((q) => q.lastAskedAt > seenBefore).length}件</span>}
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
      {items &&
        grouped(items, seenBefore).map((g) => (
          <div key={g.key} className="box-group">
            <p className="box-group-head">{g.head(g.list.length)}</p>
            {g.list.map((q, i) => (
            <motion.div
              key={q.id}
              className={`qcard ${q.lastAskedAt > seenBefore ? "is-new" : ""}`}
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 6) * 0.12, duration: 0.4, ease: "easeOut" }}
            >
              {q.lastAskedAt > seenBefore && <span className="new-chip">新着</span>}
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
              {q.followUp && (
                <p className="follow-chip">
                  🔗 続き：前の質問「{q.followUp.text}」{q.followUp.cardTitle ? `→ カード「${q.followUp.cardTitle}」` : ""}
                </p>
              )}
              <p className="qtext">{q.text}</p>
              <p className="src-meta">
                {q.askerName}さん{q.askerRole === "veteran" ? "（ベテラン）" : ""}
                {q.askers > 1 ? `ほか${q.askers - 1}人` : ""}・{fmtDate(q.createdAt)}
              </p>
              {q.askers > 1 && <span className="same-chip">👥 同じ質問：{q.askers}人</span>}
              <div className="row">
                <button className="primary" onClick={() => onAnswer({ questionId: q.id, text: q.text, askerName: q.askerName, hasPhoto: q.hasPhoto, followUp: q.followUp })}>
                  🎤 話して答える
                </button>
                <button className={`secondary good-btn ${q.good ? "done" : ""}`} disabled={q.good} onClick={() => good(q)}>
                  {q.good ? "⭐ いい質問！" : "⭐ いい質問"}
                  {q.good && <StarBurst key={q.id} />}
                </button>
              </div>
            </motion.div>
            ))}
          </div>
        ))}
      {more > 0 && <p className="hint">ほかに古い質問が {more} 件あります（新しい順に50件まで表示）。</p>}
    </section>
  );
}
