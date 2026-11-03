import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { call, db, spaces } from "../firebase";
import { CATEGORY_LABEL, LOCATION_LABEL, authorOf, fmtDate, type Card } from "../components";
import { LawSheet, lawTitle, type LawRef } from "../LawSheet";

export function Browse() {
  const [view, setView] = useState<"cards" | "laws">("cards");
  return (
    <>
      <div className="segmented">
        <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>
          🧰 親方の知恵
        </button>
        <button className={view === "laws" ? "on" : ""} onClick={() => setView("laws")}>
          ⚖️ 法令・基準
        </button>
      </div>
      {view === "cards" ? <CardList /> : <LawList />}
    </>
  );
}

function LawList() {
  const [laws, setLaws] = useState<(LawRef & { summary: string; keywords: string[] })[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    call<{ laws: (LawRef & { summary: string; keywords: string[] })[] }>("listLaws", {})
      .then((r) => setLaws(r.laws))
      .catch(() => setLaws([]));
  }, []);
  const words = q.trim().split(/\s+/).filter(Boolean);
  const shown = (laws ?? []).filter((l) => words.every((w) => `${lawTitle(l)} ${l.summary} ${l.keywords.join(" ")}`.includes(w)));
  return (
    <section className="screen">
      <h1 className="screen-title">法令・基準</h1>
      <p className="hint">電気設備の技術基準の解釈（電技解釈）・電気設備に関する技術基準を定める省令（電技省令）・電気工事士法・建設業法施行令・公共建築工事標準仕様書（標準仕様書）から、現場でよく使う条文を収めています。</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: PF 支持 / 接地 / 軽微" />
      {laws === null && <p className="hint">読み込み中…</p>}
      {shown.map((l) => (
        <button key={l.id} className="card-row law-row" onClick={() => setOpen(l.id)}>
          <strong>{lawTitle(l)}</strong>
          <span className="src-meta">{l.summary.slice(0, 60)}…</span>
        </button>
      ))}
      {open && <LawSheet id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function CardList() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [filter, setFilter] = useState<{ kind: "category" | "location"; value: string } | null>(null);
  const [open, setOpen] = useState<Card | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "cards"), where("companyId", "in", spaces()), where("status", "==", "published")),
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

  const [q, setQ] = useState("");
  const words = q.normalize("NFKC").trim().split(/s+/).filter(Boolean);
  const shown =
    cards?.filter(
      (c) =>
        (!filter || c[filter.kind] === filter.value) &&
        words.every((w) => [c.title, c.scene, c.body, c.reason, c.caution, ...(c.tags ?? [])].join(" ").normalize("NFKC").includes(w)),
    ) ?? [];

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
      <h1 className="screen-title">知恵カードを探す</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="言葉で探す（例: PF 曲げ / 脚立）" />
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
      {cards && shown.length === 0 && <p className="empty">{cards.length ? "合う知恵カードがありません。言葉や絞り込みを変えてみてください。" : "まだカードがありません。"}</p>}
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
