import { useCallback, useEffect, useState } from "react";
import { animate, motion } from "motion/react";
import { call, errorText } from "../firebase";
import { fmtDate } from "../components";
import { Transfer } from "../Transfer";

interface Mine {
  id: string;
  title: string;
  status: "draft" | "published" | "private";
  helpedCount: number;
  triggerAskerName: string | null;
  updatedAt: number;
}

const STATUS = { draft: "下書き", published: "公開中", private: "非公開" };

// The 👍 counts this device last saw, per card: the ones that grew since then are announced at the top.
const HELPED_KEY = "oyakata.helpedSeen";
export function helpedSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HELPED_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function markHelpedSeen(cards: { id: string; helpedCount: number }[]) {
  try {
    localStorage.setItem(HELPED_KEY, JSON.stringify(Object.fromEntries(cards.map((c) => [c.id, c.helpedCount]))));
  } catch {
    // private window: the news shows again next time, which is fine
  }
}
/** How many more times each card helped since this device last looked (cards with none left out). */
export function newlyHelped(cards: { id: string; helpedCount: number; status?: string }[], seen = helpedSeen()) {
  return cards.flatMap((c) => {
    const n = c.helpedCount - (seen[c.id] ?? 0);
    return c.status !== "draft" && n > 0 ? [{ id: c.id, n }] : [];
  });
}

/** The total, counted up from what was seen last time. */
function CountUp({ from, to }: { from: number; to: number }) {
  const [n, setN] = useState(from);
  useEffect(() => {
    const a = animate(from, to, { duration: Math.min(1.6, 0.4 + (to - from) * 0.15), ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => a.stop();
  }, [from, to]);
  return <>{n}</>;
}

export function MyCards({ onEdit }: { onEdit: (cardId: string) => void }) {
  const [cards, setCards] = useState<Mine[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  // what was seen before this opening (kept for the whole visit; the new counts are saved as seen once shown)
  const [seen] = useState(helpedSeen);
  useEffect(() => {
    if (cards) markHelpedSeen(cards);
  }, [cards]);
  const load = useCallback(() => {
    setErr("");
    call<{ cards: Mine[] }>("myCards", {})
      .then((r) => setCards(r.cards))
      .catch((e) => setErr(errorText(e, "カードを読み込めませんでした。電波の良い所で、ページを開き直してください。")));
  }, []);
  useEffect(load, [load]);

  const total = cards?.reduce((n, c) => n + (c.status === "published" ? c.helpedCount : 0), 0) ?? 0;
  const fresh = cards ? newlyHelped(cards, seen) : [];
  const freshOf = new Map(fresh.map((f) => [f.id, f.n]));
  const freshTotal = fresh.reduce((t, f) => t + f.n, 0);

  async function act(c: Mine, name: string, data: Record<string, unknown>) {
    setBusy(c.id);
    setErr("");
    try {
      await call(name, { cardId: c.id, ...data });
      load();
    } catch (e) {
      setErr(errorText(e, "うまくいきませんでした。電波の良い所で、もう一度お試しください。"));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="screen">
      <h1 className="screen-title">わたしのカード</h1>
      {freshTotal > 0 && (
        <motion.div className="helped-news" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="helped-news-head">👍 若手が助かりました</p>
          <p className="src-meta">前に見てから、新しく {freshTotal}回</p>
          <ul>
            {cards!
              .filter((c) => freshOf.has(c.id))
              .map((c) => (
                <li key={c.id}>
                  「{c.title}」<strong>+{freshOf.get(c.id)}</strong>
                </li>
              ))}
          </ul>
        </motion.div>
      )}
      <div className="stat">
        <span className="stat-num">{cards === null ? "—" : <CountUp from={Math.max(0, total - freshTotal)} to={total} />}</span>
        <span>回、あなたの知恵が若手を助けました</span>
      </div>
      {cards === null && !err && <p className="hint">読み込み中…</p>}
      {err && <p className="hint error">{err}</p>}
      {cards?.length === 0 && <p className="empty">まだカードがありません。「話す」から始めましょう。</p>}
      {cards?.map((c) => (
        <div key={c.id} className="qcard">
          {/* one line per card; what can be done with it opens on a tap */}
          <button className="qopen" onClick={() => setOpenCard(openCard === c.id ? null : c.id)} aria-expanded={openCard === c.id}>
            <span>
              <span className="qtext">{c.title}</span>
              <span className="src-meta card-line">
                {STATUS[c.status]}・👍 {c.helpedCount}
                {freshOf.has(c.id) && <span className="fresh-chip">+{freshOf.get(c.id)} 新しく</span>}・{fmtDate(c.updatedAt)}
              </span>
            </span>
            <span className="qopen-mark" aria-hidden>
              {openCard === c.id ? "▲" : "▼"}
            </span>
          </button>
          {openCard === c.id && (
            <div className="q-detail">
              {c.triggerAskerName && <p className="src-meta">きっかけ: {c.triggerAskerName}さんの質問</p>}
              <div className="row">
                <button className="secondary" disabled={!!busy} onClick={() => onEdit(c.id)}>
                  {c.status === "draft" ? "続きを直して公開する" : "直す"}
                </button>
                {c.status === "draft" ? (
                  <button className="secondary" disabled={!!busy} onClick={() => confirm("この下書きを消しますか？") && act(c, "deleteDraft", {})}>
                    下書きを消す
                  </button>
                ) : (
                  <button className="secondary" disabled={!!busy} onClick={() => act(c, "setCardStatus", { status: c.status === "published" ? "private" : "published" })}>
                    {c.status === "published" ? "非公開にする" : "もう一度公開する"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
      <Transfer what="あなたのカード" onMoved={load} />
    </section>
  );
}
