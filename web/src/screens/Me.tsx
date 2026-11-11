import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { call, errorText } from "../firebase";
import { askConfirm } from "../Confirm";
import { getName, getParts, savePart, setName, type PartEntry } from "../local";
import { fmtDate, LoadFailed, Skeleton } from "../components";
import { Transfer } from "../Transfer";
import { CountOnce, RecordFrame } from "../Record";

interface Q {
  id: string;
  text: string;
  status: "open" | "answered";
  answeredCardTitle: string | null;
  answeredBy: string | null; // as the card shows it (「社内のベテラン」 when the name is hidden)
  hasPhoto: boolean;
  followUp: { text: string; cardTitle: string | null } | null; // asked under an earlier answer
  good: number; // veterans who said いい質問
  askers: number; // people who sent this same question
  createdAt: number;
  answeredAt: number;
}

/** わたしの記録, counted on the server (myQuestions): only this device's own. */
interface Stats {
  understood: { total: number; thisMonth: number; lastMonth: number; recent: { text: string; at: number }[] };
  grownHelped: number; // young workers helped by the cards born from this device's questions
}

/**
 * わたしの記録: what this device came to understand and who answered it. Seen by no one else, and compared with no
 * one (no ranks, no streaks).
 */
function MyRecord({ stats, answered, onAsk }: { stats: Stats; answered: Q[]; onAsk: (text: string) => void }) {
  const u = stats.understood;
  // the name only when the card shows it (「社内のベテラン」 is the card's word for a hidden one)
  const who = (q: Q) => (q.answeredBy && q.answeredBy !== "社内のベテラン" ? `${q.answeredBy}さんが` : "親方が");
  const short = (s: string) => (s.length > 30 ? s.slice(0, 29) + "…" : s);
  return (
    <RecordFrame className="my-record" label="わたしの記録">
      <p className="record-private">この記録は、あなたにしか見えません</p>
      <p className="record-lead">
        📘 わかったこと <span className="record-num"><CountOnce to={u.total} /></span>件
        <span className="record-months">（今月 {u.thisMonth}件・先月 {u.lastMonth}件）</span>
      </p>
      {u.recent.length > 0 && u.total > u.recent.length && <p className="record-sub">最近の{u.recent.length}件</p>}
      {u.recent.length > 0 && (
        <ul className="record-asked">
          {u.recent.map((r) => (
            <li key={r.text}>
              <button className="link" onClick={() => onAsk(r.text)}>
                {short(r.text)}
              </button>
              <span className="record-date">{fmtDate(r.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {answered.length > 0 && (
        <div className="record-part">
          <p className="record-sub">🤝 親方とつながった {answered.length}件</p>
          <ul className="record-links">
            {answered.slice(0, 3).map((q) => (
              <li key={q.id}>
                「{short(q.text)}」→ {who(q)}カードで答えてくれました
              </li>
            ))}
          </ul>
        </div>
      )}
      {stats.grownHelped > 0 && <p className="record-part">🌱 あなたの質問から生まれたカードが、ほかの若手を{stats.grownHelped}人助けました</p>}
    </RecordFrame>
  );
}

// When this device last saw its answers, so the ones that came back since then are announced at the top.
const SEEN_KEY = "oyakata.meSeen";
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
    // private window: the news shows again next time, which is fine
  }
}

/** わたし (young): the answers that came back come first; settings go to the bottom. */
export function Me({ onAskAgain, onAsk }: { onAskAgain: (text: string, questionId: string) => void; onAsk: (text: string) => void }) {
  const [items, setItems] = useState<Q[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [name, setNameState] = useState(getName("young"));
  const [parts, setParts] = useState(getParts);
  // a question or a part opened to read it all
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [openPart, setOpenPart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [partErr, setPartErr] = useState(""); // shown inside the open part, where it was asked
  const [seenBefore] = useState(lastSeen);

  // read through Functions (questions are not readable from the screen: they carry device ids and photos)
  const load = useCallback(() => {
    setErr("");
    call<{ questions: Q[]; stats?: Stats }>("myQuestions", {})
      .then((r) => {
        setItems(r.questions);
        setStats(r.stats ?? null);
        // the news stays for this visit; next time only answers newer than these are news
        const newest = Math.max(0, ...r.questions.map((q) => q.answeredAt));
        if (newest > lastSeen()) markSeen(newest);
      })
      .catch((e) => setErr(errorText(e, "質問を読み込めませんでした。電波の良い所で、ページを開き直してください。")));
  }, []);
  useEffect(load, [load]);

  function toggleQ(q: Q) {
    const next = openQ === q.id ? null : q.id;
    setOpenQ(next);
    if (next && q.hasPhoto && !(q.id in photos)) {
      setPhotos((p) => ({ ...p, [q.id]: null }));
      call<{ photo: string | null }>("questionPhoto", { questionId: q.id })
        .then((r) => setPhotos((p) => ({ ...p, [q.id]: r.photo ?? "" })))
        .catch(() => setPhotos((p) => ({ ...p, [q.id]: "" })));
    }
  }

  async function withdraw(q: Q) {
    if (!(await askConfirm("この質問を取り下げますか？ 親方の質問箱から消えます。"))) return;
    setBusy(true);
    setErr("");
    try {
      await call("withdrawQuestion", { questionId: q.id });
      setItems((list) => list?.filter((x) => x.id !== q.id) ?? null);
      setOpenQ(null);
    } catch (e) {
      setErr(errorText(e, "取り下げられませんでした。もう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  // an entry from before the details were kept: ask the AI of 撮る again by the name (no photo)
  async function lookAgain(p: PartEntry) {
    setBusy(true);
    setPartErr("");
    try {
      const r = await call<{ verdict: string; use: string; fieldNames: string[]; confusables: { name: string; diff: string }[]; companions: string[] }>("identifyPart", { name: p.name });
      // a name the AI could not settle leaves the entry as it was
      if (r.verdict === "unknown") {
        setPartErr("この名前では、くわしく調べられませんでした。もう一度「撮る」で撮ってみてください。");
        return;
      }
      savePart({ ...p, use: r.use || p.use, fieldNames: r.fieldNames, printed: p.printed ?? "", confusables: r.confusables, companions: r.companions });
      setParts(getParts());
    } catch (e) {
      setPartErr(errorText(e, "調べ直せませんでした。電波の良い所で、もう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  const answered = items?.filter((q) => q.status === "answered") ?? [];
  const news = answered.filter((q) => q.answeredAt > seenBefore);
  // a hidden card has nothing to show when asked again
  const canAsk = (q: Q) => q.status === "answered" && q.answeredCardTitle !== "（いまは非公開のカード）";

  return (
    <section className="screen">
      <h1 className="screen-title">わたし</h1>
      {stats && <MyRecord stats={stats} answered={answered} onAsk={onAsk} />}

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
            <button className="primary" onClick={() => onAskAgain(q.text, q.id)}>
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
      {err && items !== null && <p className="hint error">{err}</p>}
      {items === null && (err ? <LoadFailed what="質問" onRetry={load} /> : <Skeleton />)}
      {items?.length === 0 && <p className="empty">まだありません。答えが見つからない時は「親方に聞く」を押しましょう。</p>}
      {items?.map((q) => (
        <div key={q.id} className={`qcard ${q.status}`}>
          <button className="qopen" onClick={() => toggleQ(q)} aria-expanded={openQ === q.id}>
            <span className="qtext">
              {q.hasPhoto && <span aria-label="写真つき">📷 </span>}
              {q.text}
            </span>
            <span className="qopen-mark" aria-hidden>
              {openQ === q.id ? "▲" : "▼"}
            </span>
          </button>
          {openQ === q.id && (
            <div className="q-detail">
              <p className="src-meta">送った日：{fmtDate(q.createdAt)}</p>
              {q.followUp && (
                <p className="follow-chip">
                  🔗 続き：前の質問「{q.followUp.text}」{q.followUp.cardTitle ? `→ カード「${q.followUp.cardTitle}」` : ""}
                </p>
              )}
              {q.hasPhoto &&
                (photos[q.id] === null ? (
                  <p className="hint">写真を読み込み中…</p>
                ) : photos[q.id] ? (
                  <img className="photo-preview" src={photos[q.id]!} alt="送った写真" />
                ) : (
                  <p className="hint">写真を読み込めませんでした。</p>
                ))}
              {q.status === "open" && (
                <button className="link danger" disabled={busy} onClick={() => void withdraw(q)}>
                  この質問を取り下げる
                </button>
              )}
            </div>
          )}
          {q.good > 0 && <p className="good-note">⭐ 親方が「いい質問」と言ってくれました{q.good > 1 ? `（${q.good}人）` : ""}</p>}
          {q.askers > 1 && <p className="src-meta">👥 {q.askers}人が同じことを聞いています</p>}
          {q.status === "answered" && q.answeredAt > seenBefore ? (
            <p className="born">🎉 答えが届きました（上の知らせ）</p>
          ) : q.status === "answered" ? (
            <>
              <p className="born">
                🎉 {q.answeredBy ?? "社内のベテラン"}が答えてくれました：「{q.answeredCardTitle ?? "…"}」
              </p>
              {canAsk(q) && (
                <button className="secondary" onClick={() => onAskAgain(q.text, q.id)}>
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
          <div key={p.name} className={`part-item ${openPart === p.name ? "open" : ""}`}>
            <button className="part-open" onClick={() => {
                setOpenPart(openPart === p.name ? null : p.name);
                setPartErr("");
              }} aria-expanded={openPart === p.name}>
              {p.thumb ? <img src={p.thumb} alt="" /> : <span className="part-noimg">📦</span>}
              <div>
                <strong>{p.name}</strong>
                <p className="src-meta">
                  {p.use}・{fmtDate(p.at)}
                </p>
              </div>
            </button>
            {openPart === p.name && (
              <div className="part-detail">
                {p.thumb && <img className="part-big" src={p.thumb} alt={`${p.name}の写真`} />}
                {!!p.fieldNames?.length && <p>現場の呼び名：{p.fieldNames.join("・")}</p>}
                {p.printed && <p>🔍 読み取った印字：{p.printed}</p>}
                {!!p.confusables?.length && (
                  <div>
                    <p className="part-sub">⚠️ 間違えやすい相手</p>
                    {p.confusables.map((c) => (
                      <p key={c.name}>
                        <strong>{c.name}</strong>：{c.diff}
                      </p>
                    ))}
                  </div>
                )}
                {!!p.companions?.length && <p>🔩 一緒に使う物：{p.companions.join("・")}</p>}
                {!p.fieldNames && <p className="hint">この部材は、くわしい結果を残す前に撮ったものです。</p>}
                <div className="row">
                  <button className="secondary" onClick={() => onAsk(`${p.name}の使い方と、気をつけることは？`)}>
                    この部材について聞く →
                  </button>
                  <button className="link" disabled={busy} onClick={() => void lookAgain(p)}>
                    {busy ? "調べています…" : "くわしく調べ直す"}
                  </button>
                </div>
                {partErr && <p className="hint error">{partErr}</p>}
                <p className="src-meta">💡 AIの判定です。印字・現物で確かめてください。</p>
              </div>
            )}
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
