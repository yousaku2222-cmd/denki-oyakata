import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { call, errorText } from "../firebase";
import { fmtDate, LoadFailed, Skeleton } from "../components";
import type { Topic } from "./Talk";

interface Q {
  id: string;
  text: string;
  askerName: string;
  askerRole: string;
  hasPhoto: boolean;
  photoPart?: string | null; // what ⑤撮る's AI took the photo for
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
/**
 * A question's photo, small beside it. It is read when it comes into view (each is up to 300KB: reading all of
 * them at once is slow on a site's signal); a tap makes it large.
 */
function QPhoto({ photo, load }: { photo: string | null | undefined; load: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (photo !== undefined || !ref.current) return;
    // a browser without it reads the photo at once
    if (typeof IntersectionObserver === "undefined") return load();
    const io = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [photo, load]);
  return (
    <button ref={ref} type="button" className={`qphoto ${big ? "big" : ""}`} onClick={() => (photo ? setBig(!big) : photo === "" && load())} aria-label={photo === "" ? "写真を読み直す" : big ? "写真を小さくする" : "写真を大きくする"}>
      {photo ? <img src={photo} alt="若手が撮った写真" /> : <span>{photo === "" ? "📷✕" : "📷"}</span>}
    </button>
  );
}

export function StarBurst() {
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
export function lastSeen(): number {
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
  // what the young asked the AI and no card answered: not sent to anyone, but the next one to ask gets the answer
  const [aiOnly, setAiOnly] = useState<string[]>([]);

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
  useEffect(() => {
    call<{ questions: string[] }>("talkSeeds", {})
      .then((r) => setAiOnly(r.questions))
      .catch(() => {}); // only extra
  }, []);

  // a question also sent to the box is answered there (where the one who asked hears back)
  const sameWords = (t: string) => t.normalize("NFKC").replace(/[\s？?。、]/g, "");
  const shownAiOnly = aiOnly.filter((t) => !items?.some((q) => sameWords(q.text) === sameWords(t)));

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
      <div className="hint">
        話しても書いても答えられ、答えは知恵カードになります。
        <details className="more-info">
          <summary>？</summary>
          若手が親方に聞きたい質問です。「答える（話す・書く）」を押すと、話しても文字で書いても答えられ、答えは知恵カードになります。「⭐ いい質問」を押すと、聞いた若手に届きます。答えたあとの画面でも押せます。
        </details>
      </div>
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
      {err && items !== null && <p className="hint error">{err}</p>}
      {items === null && (err ? <LoadFailed what="質問" onRetry={load} /> : <Skeleton />)}
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
              {/* photo on the left, the question beside it; いい質問 is a star in the corner */}
              <div className="qrow">
                {q.hasPhoto && <QPhoto photo={photos[q.id]} load={() => openPhoto(q)} />}
                <div className="qmain">
                  <div className="qtop">
                    {q.lastAskedAt > seenBefore ? <span className="new-chip">新着</span> : <span />}
                    <button className={`star-btn ${q.good ? "done" : ""}`} disabled={q.good} onClick={() => good(q)} aria-label={q.good ? "いい質問と伝えました" : "いい質問と伝える"} title="いい質問">
                      {q.good ? "⭐" : "☆"}
                      {/* the star alone says nothing on a phone (no title there) */}
                      <span className="star-word" aria-hidden>
                        {q.good ? "伝えました" : "いい質問"}
                      </span>
                      {q.good && <StarBurst key={q.id} />}
                    </button>
                  </div>
                  {q.followUp && (
                    <p className="follow-chip">
                      🔗 続き：前の質問「{q.followUp.text}」{q.followUp.cardTitle ? `→ カード「${q.followUp.cardTitle}」` : ""}
                    </p>
                  )}
                  <p className="qtext">{q.text}</p>
                  {q.hasPhoto && q.photoPart && <p className="src-meta">📷 写真の物（AIの判定）：{q.photoPart}</p>}
                  <p className="src-meta">
                    {q.askerName}さん{q.askerRole === "veteran" ? "（ベテラン）" : ""}・{fmtDate(q.createdAt)}
                    {q.askers > 1 ? `・👥 ${q.askers}人が同じ質問` : ""}
                  </p>
                </div>
              </div>
              <button className="primary answer-btn" onClick={() => onAnswer({ questionId: q.id, text: q.text, askerName: q.askerName, hasPhoto: q.hasPhoto, followUp: q.followUp, good: q.good })}>
                ✍️ 答える（話す・書く）
              </button>
            </motion.div>
            ))}
          </div>
        ))}
      {more > 0 && <p className="hint">ほかに古い質問が {more} 件あります（新しい順に50件まで表示）。</p>}
      {shownAiOnly.length > 0 && (
        <div className="box-group ai-only">
          <p className="box-group-head">🤖 AIだけで答えた質問（親方の知恵がまだありません）</p>
          <div className="hint">
            答えると、次に聞いた若手の答えに使われます。
            <details className="more-info">
              <summary>？</summary>
              若手がAIに聞いて、法令や一般知識だけで答えた質問です。親方には送られていないので、答えても聞いた本人には届きませんが、次に同じことを聞いた若手の答えに使われます。
            </details>
          </div>
          {shownAiOnly.map((text) => (
            <div key={text} className="qcard">
              <p className="qtext">{text}</p>
              <button className="secondary answer-btn" onClick={() => onAnswer({ questionId: "", text, askerName: "若手", hasPhoto: false })}>
                ✍️ 答える（話す・書く）
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
