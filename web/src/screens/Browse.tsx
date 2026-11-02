import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { COMPANY, db } from "../firebase";
import { CATEGORY_LABEL, LOCATION_LABEL, authorOf, fmtDate, type Card } from "../components";

export function Browse() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [filter, setFilter] = useState<{ kind: "category" | "location"; value: string } | null>(null);
  const [open, setOpen] = useState<Card | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "cards"), where("companyId", "==", COMPANY), where("status", "==", "published")),
        (snap) =>
          setCards(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<Card, "id">) }))
              .sort((a, b) => (b.publishedAt?.toMillis() ?? 0) - (a.publishedAt?.toMillis() ?? 0)),
          ),
        () => setCards([]),
      ),
    [],
  );

  const shown = cards?.filter((c) => !filter || c[filter.kind] === filter.value) ?? [];

  if (open) {
    return (
      <section className="screen">
        <button className="link" onClick={() => setOpen(null)}>
          ← 一覧へ
        </button>
        <article className="wisdom-card">
          <p className="wc-author">
            🧰 {authorOf(open)}の知恵・{fmtDate(open.publishedAt?.toMillis())}・👍 {open.helpedCount}
          </p>
          <h1>{open.title}</h1>
          {open.scene && <Part label="場面" text={open.scene} />}
          <Part label="やり方・コツ" text={open.body} />
          {open.reason && <Part label="なぜ・失敗" text={open.reason} />}
          {open.caution && <Part label="新人がよく間違えること" text={open.caution} />}
          {open.triggerAskerName && <p className="src-meta">きっかけ: {open.triggerAskerName}さんの質問</p>}
        </article>
      </section>
    );
  }

  return (
    <section className="screen">
      <h1 className="screen-title">知恵袋を探す</h1>
      <p className="hint">場所</p>
      <div className="tiles">
        {Object.entries(LOCATION_LABEL).map(([k, v]) => (
          <Tile key={k} label={v} on={filter?.kind === "location" && filter.value === k} onClick={() => setFilter(filter?.value === k ? null : { kind: "location", value: k })} />
        ))}
      </div>
      <p className="hint">種類</p>
      <div className="tiles">
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <Tile key={k} label={v} on={filter?.kind === "category" && filter.value === k} onClick={() => setFilter(filter?.value === k ? null : { kind: "category", value: k })} />
        ))}
      </div>
      {cards === null && <p className="hint">読み込み中…</p>}
      {cards && shown.length === 0 && <p className="empty">まだカードがありません。</p>}
      {shown.map((c) => (
        <button key={c.id} className="card-row" onClick={() => setOpen(c)}>
          <strong>{c.title}</strong>
          <span className="src-meta">
            {authorOf(c)}・👍 {c.helpedCount}
          </span>
        </button>
      ))}
    </section>
  );
}

function Part({ label, text }: { label: string; text: string }) {
  return (
    <div className="wc-part">
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function Tile({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`tile ${on ? "on" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}
