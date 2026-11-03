import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { call, errorText } from "../firebase";
import { getName, getParts, setName } from "../local";
import { fmtDate } from "../components";
import { Transfer } from "../Transfer";

interface Q {
  id: string;
  text: string;
  status: "open" | "answered";
  answeredCardTitle: string | null;
  answeredBy: string | null; // as the card shows it (「社内のベテラン」 when the name is hidden)
  hasPhoto: boolean;
  good: number; // veterans who said いい質問
  askers: number; // people who sent this same question
  createdAt: number;
  answeredAt: number;
}

// When this device last saw its answers, so the ones that came back since then are announced at the top.
const SEEN_KEY = "oyakata.meSeen";
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
    // private window: the news shows again next time, which is fine
  }
}

/** わたし (young): the answers that came back come first; settings go to the bottom. */
export function Me({ onAskAgain }: { onAskAgain: (text: string) => void }) {
  const [items, setItems] = useState<Q[] | null>(null);
  const [err, setErr] = useState("");
  const [name, setNameState] = useState(getName("young"));
  const [parts] = useState(getParts);
  const [seenBefore] = useState(lastSeen);

  // read through Functions (questions are not readable from the screen: they carry device ids and photos)
  const load = useCallback(() => {
    setErr("");
    call<{ questions: Q[] }>("myQuestions", {})
      .then((r) => {
        setItems(r.questions);
        // the news stays for this visit; next time only answers newer than these are news
        const newest = Math.max(0, ...r.questions.map((q) => q.answeredAt));
        if (newest > lastSeen()) markSeen(newest);
      })
      .catch((e) => setErr(errorText(e, "質問を読み込めませんでした。電波の良い所で、ページを開き直してください。")));
  }, []);
  useEffect(load, [load]);

  const answered = items?.filter((q) => q.status === "answered") ?? [];
  const news = answered.filter((q) => q.answeredAt > seenBefore);
  // a hidden card has nothing to show when asked again
  const canAsk = (q: Q) => q.status === "answered" && q.answeredCardTitle !== "（いまは非公開のカード）";

  return (
    <section className="screen">
      <h1 className="screen-title">わたし</h1>

      {news.map((q, i) => (
        <motion.div
          key={q.id}
          className="born-news"
          initial={{ opacity: 0, y: -14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, boxShadow: ["0 0 0 0 rgba(245,196,0,0)", "0 0 0 8px rgba(245,196,0,0.45)", "0 0 0 2px rgba(245,196,0,0.9)"] }}
          transition={{ delay: 0.2 + i * 0.15, duration: 0.5, boxShadow: { delay: 0.5 + i * 0.15, duration: 1.2 } }}
        >
          <p className="born-head">🎉 あなたの質問から知恵カードが生まれました</p>
          <p className="born-title">「{q.answeredCardTitle}」</p>
          <p className="src-meta">
            {q.answeredBy ?? "社内のベテラン"}が答えてくれました・あなたの質問「{q.text.length > 30 ? q.text.slice(0, 29) + "…" : q.text}」
          </p>
          {canAsk(q) && (
            <button className="primary" onClick={() => onAskAgain(q.text)}>
              答えを聞く →
            </button>
          )}
        </motion.div>
      ))}

      <div className="stat">
        <span className="stat-num">{items === null ? "—" : answered.length}</span>
        <span>枚の知恵カードが、あなたの質問から生まれました</span>
      </div>

      <h2 className="sub">親方に聞いた質問</h2>
      {err && <p className="hint error">{err}</p>}
      {items === null && !err && <p className="hint">読み込み中…</p>}
      {items?.length === 0 && <p className="empty">まだありません。答えが見つからない時は「親方に聞いてみる」を押しましょう。</p>}
      {items?.map((q) => (
        <div key={q.id} className={`qcard ${q.status}`}>
          <p className="qtext">
            {q.hasPhoto && <span aria-label="写真つき">📷 </span>}
            {q.text}
          </p>
          {q.good > 0 && <p className="good-note">⭐ 親方が「いい質問」と言ってくれました{q.good > 1 ? `（${q.good}人）` : ""}</p>}
          {q.askers > 1 && <p className="src-meta">👥 {q.askers}人が同じことを聞いています</p>}
          {q.status === "answered" ? (
            <>
              <p className="born">
                🎉 {q.answeredBy ?? "社内のベテラン"}が答えてくれました：「{q.answeredCardTitle ?? "…"}」
              </p>
              {canAsk(q) && (
                <button className="secondary" onClick={() => onAskAgain(q.text)}>
                  答えを聞く →
                </button>
              )}
            </>
          ) : (
            <p className="src-meta">親方の答え待ち・{fmtDate(q.createdAt)}</p>
          )}
        </div>
      ))}

      <h2 className="sub-title">📷 わたしの部材帳</h2>
      {parts.length === 0 && <p className="empty">「撮る」で調べた部材が、ここにたまります。</p>}
      <div className="parts-book">
        {parts.map((p) => (
          <div key={p.name} className="part-item">
            {p.thumb ? <img src={p.thumb} alt="" /> : <span className="part-noimg">📦</span>}
            <div>
              <strong>{p.name}</strong>
              <p className="src-meta">
                {p.use}・{fmtDate(p.at)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="sub-title">⚙️ 設定</h2>
      <label className="field">
        <span>呼び名（質問箱に表示されます。任意）</span>
        <input
          value={name}
          placeholder="例: たろう"
          maxLength={30}
          onChange={(e) => {
            setNameState(e.target.value);
            setName("young", e.target.value);
          }}
        />
      </label>
      <Transfer what="あなたの質問" onMoved={load} />
    </section>
  );
}
