import { useCallback, useEffect, useState } from "react";
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

export function MyCards({ onEdit }: { onEdit: (cardId: string) => void }) {
  const [cards, setCards] = useState<Mine[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    call<{ cards: Mine[] }>("myCards", {})
      .then((r) => setCards(r.cards))
      .catch((e) => setErr(errorText(e, "カードを読み込めませんでした。電波の良い所で、ページを開き直してください。")));
  }, []);
  useEffect(load, [load]);

  const total = cards?.reduce((n, c) => n + (c.status === "published" ? c.helpedCount : 0), 0) ?? 0;

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
      <div className="stat">
        <span className="stat-num">{total}</span>
        <span>回、あなたの知恵が若手を助けました</span>
      </div>
      {cards === null && !err && <p className="hint">読み込み中…</p>}
      {err && <p className="hint error">{err}</p>}
      {cards?.length === 0 && <p className="empty">まだカードがありません。「話す」から始めましょう。</p>}
      {cards?.map((c) => (
        <div key={c.id} className="qcard">
          <p className="qtext">{c.title}</p>
          <p className="src-meta">
            {STATUS[c.status]}・👍 {c.helpedCount}・{fmtDate(c.updatedAt)}
            {c.triggerAskerName ? `・きっかけ: ${c.triggerAskerName}さんの質問` : ""}
          </p>
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
      ))}
      <Transfer what="あなたのカード" onMoved={load} />
    </section>
  );
}
