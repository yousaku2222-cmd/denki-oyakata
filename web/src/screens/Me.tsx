import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { COMPANY, db, myId } from "../firebase";
import { getName, setName } from "../local";
import { fmtDate } from "../components";

interface Q {
  id: string;
  text: string;
  status: "open" | "answered";
  answeredCardId: string | null;
  createdAt: { toMillis(): number } | null;
}

export function Me() {
  const [items, setItems] = useState<Q[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [name, setNameState] = useState(getName("young"));

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "questions"), where("companyId", "==", COMPANY), where("askerId", "==", myId())),
        (snap) =>
          setItems(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<Q, "id">) }))
              .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
          ),
        () => setItems([]),
      ),
    [],
  );

  useEffect(() => {
    for (const q of items ?? []) {
      const id = q.answeredCardId;
      if (id && !titles[id]) {
        getDoc(doc(db, "cards", id))
          .then((d) => d.exists() && setTitles((t) => ({ ...t, [id]: d.get("title") as string })))
          .catch(() => undefined);
      }
    }
  }, [items, titles]);

  const born = items?.filter((q) => q.status === "answered").length ?? 0;

  return (
    <section className="screen">
      <h1 className="screen-title">わたし</h1>
      <label className="field">
        <span>呼び名（質問箱に表示されます。任意）</span>
        <input
          value={name}
          placeholder="例: たろう"
          onChange={(e) => {
            setNameState(e.target.value);
            setName("young", e.target.value);
          }}
        />
      </label>
      <div className="stat">
        <span className="stat-num">{born}</span>
        <span>枚の知恵カードが、あなたの質問から生まれました</span>
      </div>
      <h2 className="sub">親方に聞いた質問</h2>
      {items === null && <p className="hint">読み込み中…</p>}
      {items?.length === 0 && <p className="empty">まだありません。答えが見つからない時は「親方に聞いてみる」を押しましょう。</p>}
      {items?.map((q) => (
        <div key={q.id} className={`qcard ${q.status}`}>
          <p className="qtext">{q.text}</p>
          {q.status === "answered" ? (
            <p className="born">🎉 親方が答えてくれました：「{titles[q.answeredCardId ?? ""] ?? "…"}」</p>
          ) : (
            <p className="src-meta">親方の答え待ち・{fmtDate(q.createdAt?.toMillis())}</p>
          )}
        </div>
      ))}
    </section>
  );
}
