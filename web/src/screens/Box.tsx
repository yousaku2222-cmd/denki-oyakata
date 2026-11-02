import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { COMPANY, call, db } from "../firebase";
import { deviceId } from "../local";
import { fmtDate } from "../components";
import type { Topic } from "./Talk";

interface Q {
  id: string;
  text: string;
  askerName: string;
  askerRole: string;
  excludeVeteranId: string | null;
  goodBy: string[];
  createdAt: { toMillis(): number } | null;
}

export function Box({ onAnswer }: { onAnswer: (t: Topic) => void }) {
  const [items, setItems] = useState<Q[] | null>(null);
  const me = deviceId();

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "questions"), where("companyId", "==", COMPANY), where("status", "==", "open")),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Q, "id">) }))
            .filter((q) => q.excludeVeteranId !== me)
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
          setItems(list);
        },
        () => setItems([]),
      ),
    [me],
  );

  return (
    <section className="screen">
      <h1 className="screen-title">答えてほしい質問</h1>
      <p className="hint">若手が答えを見つけられなかった質問です。押すと、そのまま話して答えられます。</p>
      {items === null && <p className="hint">読み込み中…</p>}
      {items?.length === 0 && <p className="empty">いまは質問がありません。</p>}
      {items?.map((q) => {
        const good = q.goodBy?.includes(me);
        return (
          <div key={q.id} className="qcard">
            <p className="qtext">{q.text}</p>
            <p className="src-meta">
              {q.askerName || "若手"}さん{q.askerRole === "veteran" ? "（ベテラン）" : ""}・{fmtDate(q.createdAt?.toMillis())}
            </p>
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ questionId: q.id, text: q.text, askerName: q.askerName || "若手" })}>
                🎤 話して答える
              </button>
              <button
                className={`secondary ${good ? "done" : ""}`}
                disabled={good}
                onClick={() => call("markGoodQuestion", { questionId: q.id, veteranId: me })}
              >
                {good ? "⭐ いい質問！" : "⭐ いい質問"}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
