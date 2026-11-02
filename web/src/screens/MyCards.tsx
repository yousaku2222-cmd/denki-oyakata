import { useCallback, useEffect, useState } from "react";
import { call } from "../firebase";
import { deviceId } from "../local";
import { fmtDate } from "../components";

interface Mine {
  id: string;
  title: string;
  status: "draft" | "published" | "private";
  helpedCount: number;
  triggerAskerName: string | null;
  updatedAt: number;
}

const STATUS = { draft: "下書き", published: "公開中", private: "非公開" };

export function MyCards() {
  const [cards, setCards] = useState<Mine[] | null>(null);
  const load = useCallback(() => {
    call<{ cards: Mine[] }>("myCards", { authorId: deviceId() })
      .then((r) => setCards(r.cards))
      .catch(() => setCards([]));
  }, []);
  useEffect(load, [load]);

  const total = cards?.reduce((n, c) => n + (c.status === "published" ? c.helpedCount : 0), 0) ?? 0;

  async function toggle(c: Mine) {
    await call("setCardStatus", { cardId: c.id, authorId: deviceId(), status: c.status === "published" ? "private" : "published" });
    load();
  }

  return (
    <section className="screen">
      <h1 className="screen-title">わたしのカード</h1>
      <div className="stat">
        <span className="stat-num">{total}</span>
        <span>回、あなたの知恵が若手を助けました</span>
      </div>
      {cards === null && <p className="hint">読み込み中…</p>}
      {cards?.length === 0 && <p className="empty">まだカードがありません。「話す」から始めましょう。</p>}
      {cards?.map((c) => (
        <div key={c.id} className="qcard">
          <p className="qtext">{c.title}</p>
          <p className="src-meta">
            {STATUS[c.status]}・👍 {c.helpedCount}・{fmtDate(c.updatedAt)}
            {c.triggerAskerName ? `・きっかけ: ${c.triggerAskerName}さんの質問` : ""}
          </p>
          {c.status !== "draft" && (
            <button className="secondary" onClick={() => toggle(c)}>
              {c.status === "published" ? "非公開にする" : "もう一度公開する"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
