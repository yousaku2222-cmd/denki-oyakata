import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { call, errorText } from "../firebase";
import { fmtDate } from "../components";
import { Transfer } from "../Transfer";
import { CountOnce, RecordFrame } from "../Record";

interface Mine {
  id: string;
  title: string;
  status: "draft" | "published" | "private";
  helpedCount: number;
  triggerAskerName: string | null;
  updatedAt: number;
  publishedAt: number | null;
  fromQuestion: boolean;
}

/** What myCards returns besides the cards: the box waiting, the young workers' words, and what was reached. */
interface Reach {
  openQuestions: number;
  thanks: { id: string; text: string; cardTitle: string | null; createdAt: number }[];
  milestones: { kind: MilestoneKind; at: number | null }[];
}
type MilestoneKind = "firstCard" | "fifthCard" | "firstHelp" | "help10" | "help30" | "firstAnswer";
const MILESTONE: Record<MilestoneKind, string> = {
  firstCard: "はじめての知恵カードを公開",
  fifthCard: "知恵カード5枚目を公開",
  firstHelp: "若手の役に初めて立った",
  help10: "10人の若手の役に立った",
  help30: "30人の若手の役に立った",
  firstAnswer: "質問箱の質問に初めて答えた",
};

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
export function markHelpedSeen(cards: { id: string; helpedCount: number }[]) {
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

/**
 * あなたの知恵が届いた先: one quiet frame above the cards. What the veteran's words did, the questions waiting for
 * them, and what young workers wrote back. Only what happened is shown (nothing to unlock, no ranks).
 */
function ReachFrame({ cards, reach, onOpenBox, onHide }: { cards: Mine[]; reach: Reach; onOpenBox: () => void; onHide: (id: string) => void }) {
  const live = cards.filter((c) => c.status === "published");
  const helped = live.reduce((n, c) => n + c.helpedCount, 0);
  const best = live.reduce<Mine | null>((b, c) => (c.helpedCount > (b?.helpedCount ?? 0) ? c : b), null);
  return (
    <RecordFrame className="reach" label="あなたの知恵が届いた先">
      <p className="record-kicker">あなたの知恵が届いた先</p>
      {helped > 0 ? (
        <p className="record-lead">
          あなたの知恵で、<span className="record-num"><CountOnce to={helped} /></span>人の若手が助かりました
        </p>
      ) : (
        <p className="record-lead">若手の役に立つと、ここに届きます</p>
      )}
      {reach.openQuestions > 0 && (
        <div className="record-row">
          <span>📮 若手の質問が{reach.openQuestions}件、あなたを待っています</span>
          <button className="secondary" onClick={onOpenBox}>
            質問箱を見る
          </button>
        </div>
      )}
      {best && (
        <div className="record-part">
          <p className="record-sub">いちばん役に立ったカード</p>
          <p className="record-best">
            「{best.title}」<span className="record-count">👍 {best.helpedCount}</span>
          </p>
        </div>
      )}
      {reach.thanks.length > 0 && (
        <div className="record-part">
          <p className="record-sub">届いたひとこと</p>
          <ul className="record-thanks">
            {reach.thanks.map((t) => (
              <li key={t.id}>
                <p className="record-thanks-text">{t.text}</p>
                <p className="src-meta">
                  若手より{t.cardTitle ? `・「${t.cardTitle}」` : ""}・{fmtDate(t.createdAt)}
                  <button className="link record-hide" onClick={() => onHide(t.id)}>
                    表示しない
                  </button>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reach.milestones.length > 0 && (
        <div className="record-part">
          <p className="record-sub">節目の記録</p>
          <ul className="record-milestones">
            {reach.milestones.map((m) => (
              <li key={m.kind}>
                <span className="record-date">{m.at ? fmtDate(m.at) : "（日付は記録前）"}</span>
                <span>{MILESTONE[m.kind]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RecordFrame>
  );
}

export function MyCards({ onEdit, onOpenBox }: { onEdit: (cardId: string) => void; onOpenBox: () => void }) {
  const [cards, setCards] = useState<Mine[] | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
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
    call<{ cards: Mine[] } & Reach>("myCards", {})
      .then((r) => {
        setCards(r.cards);
        setReach({ openQuestions: r.openQuestions ?? 0, thanks: r.thanks ?? [], milestones: r.milestones ?? [] });
      })
      .catch((e) => setErr(errorText(e, "カードを読み込めませんでした。電波の良い所で、ページを開き直してください。")));
  }, []);
  useEffect(load, [load]);

  const fresh = cards ? newlyHelped(cards, seen) : [];
  const freshOf = new Map(fresh.map((f) => [f.id, f.n]));
  const freshTotal = fresh.reduce((t, f) => t + f.n, 0);

  // 「表示しない」: gone from the frame at once; brought back if the server did not take it
  async function hideThanks(id: string) {
    const before = reach;
    setReach((r) => (r ? { ...r, thanks: r.thanks.filter((t) => t.id !== id) } : r));
    setErr("");
    try {
      await call("hideThanks", { thanksId: id });
    } catch (e) {
      setReach(before);
      setErr(errorText(e, "うまくいきませんでした。電波の良い所で、もう一度お試しください。"));
    }
  }

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
      {cards && reach ? (
        <ReachFrame cards={cards} reach={reach} onOpenBox={onOpenBox} onHide={(id) => void hideThanks(id)} />
      ) : (
        <div className="stat">
          <span className="stat-num">—</span>
          <span>人の若手が、あなたの知恵で助かりました</span>
        </div>
      )}
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
