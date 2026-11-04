import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { call, db, spaces } from "../firebase";
import { CATEGORY_LABEL, LOCATION_LABEL, LoadFailed, Skeleton, authorOf, fmtDate, type Card } from "../components";
import { LawSheet, lawTitle, type LawRef } from "../LawSheet";
import { Meanings, useGlossary } from "../Glossary";
import { Icon, ic } from "../Icon";

// pictures first: the same icons wherever a place or a kind is shown
const LOCATION_ICON: Record<string, string> = { ceiling: ic("ceiling"), floor: ic("floor"), outdoor: ic("outdoor"), panel: ic("panel"), other: "…" };
const CATEGORY_ICON: Record<string, string> = { piping: ic("piping"), wiring: ic("wiring"), grounding: ic("ground"), license: ic("license_scope"), calc: ic("calc"), safety: ic("safety"), other: "…" };
const MEDALS = ["🥇", "🥈", "🥉"];

export function Browse() {
  const [view, setView] = useState<"cards" | "laws">("cards");
  return (
    <>
      <div className="browse-pick">
        <button className={`pick ${view === "cards" ? "on" : ""}`} onClick={() => setView("cards")}>
          <Icon of={ic("wisdom")} className="pick-icon" />
          <strong>親方の知恵</strong>
          <small>現場の知恵カード</small>
        </button>
        <button className={`pick ${view === "laws" ? "on" : ""}`} onClick={() => setView("laws")}>
          <Icon of="⚖️" className="pick-icon" />
          <strong>法令・基準</strong>
          <small>国の決まり・原文つき</small>
        </button>
      </div>
      <div className="browse-lead">
        <details className="more-info hint">
          <summary>？ 探すとは</summary>
          AI を通さず、自分で知恵カードと条文を見る所です。答えが欲しい時は「聞く」へ。
        </details>
      </div>
      {view === "cards" ? <CardList /> : <LawList />}
    </>
  );
}

type LawItem = LawRef & { summary: string; keywords: string[]; points: string[]; scenes: string[] };

// 場面で探す: by the article's heading (and a few named by id), so every one of the articles is under some button
const LAW_SCENES: { label: string; icon: string; words: string[]; ids?: string[] }[] = [
  { label: "配管", icon: ic("piping"), words: ["管"] },
  { label: "ケーブル・ラック", icon: ic("cable"), words: ["ケーブル", "ラック"], ids: ["kaishaku-120"] },
  {
    label: "配線・電線",
    icon: ic("wiring"),
    words: ["施設場所による工事の種類", "がいし", "線ぴ", "裸電線", "使用する電線", "高圧配線", "特殊な低圧屋内配線", "メタルラス", "用語の定義", "電線の規格", "コード", "電線の接続", "ダクト", "屋側", "屋外配線", "電球線", "移動電線", "特殊な配線", "引込線"],
  },
  { label: "接地", icon: ic("ground"), words: ["接地"] },
  { label: "絶縁・漏電", icon: ic("leak"), words: ["絶縁", "漏電", "地絡", "対地電圧", "混触", "避雷器"] },
  { label: "分岐・ブレーカー", icon: ic("outlet"), words: ["分岐", "開閉器", "幹線", "過電流遮断器", "配線器具"], ids: ["kaishaku-146"] },
  {
    label: "機器・照明",
    icon: ic("ceiling"),
    words: ["電気機械器具", "電熱", "電動機", "蓄電池", "電磁障害", "放電灯", "ネオン", "照明", "信号灯", "表示灯", "小勢力", "溶接", "集じん", "電気さく", "殺虫", "エックス線", "温床", "浴器", "電気防食", "遊戯用", "小規模発電"],
  },
  { label: "特殊な場所", icon: ic("safety"), words: ["粉じん", "可燃性ガス", "危険物", "火薬庫", "トンネル", "臨時配線", "接触電線", "滑走路"] },
  { label: "資格・工事範囲", icon: ic("license_scope"), words: ["電気工事", "資格", "軽微", "技術者", "金額"], ids: ["335AC0000000139-2"] },
];
const inScene = (l: LawItem, s: (typeof LAW_SCENES)[number]) => !!s.ids?.includes(l.id) || s.words.some((w) => l.heading.normalize("NFKC").includes(w));
const wordsOf = (q: string) => q.normalize("NFKC").trim().split(/\s+/).filter(Boolean);

function LawList() {
  const [laws, setLaws] = useState<LawItem[] | null>(null);
  const [q, setQ] = useState("");
  const [scene, setScene] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false); // a hundred articles at once is a wall of text: a scene or a word first
  const terms = useGlossary();
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setFailed(false);
    call<{ laws: LawItem[] }>("listLaws", {})
      .then((r) => setLaws(r.laws))
      .catch(() => setFailed(true));
  }, [tries]);
  const words = wordsOf(q);
  const s = LAW_SCENES.find((x) => x.label === scene);
  // a word typed that is one of the words explained: its meaning first (the exact word before longer ones), then the articles
  const meant = words.length
    ? terms
        .filter((t) => words.some((w) => w.length >= 2 && t.term.normalize("NFKC").includes(w)))
        .sort((a, b) => Number(words.includes(b.term)) - Number(words.includes(a.term)) || a.term.length - b.term.length)
        .slice(0, 3)
    : [];
  const shown = (laws ?? []).filter(
    (l) => (!s || inScene(l, s)) && words.every((w) => [lawTitle(l), l.summary, ...l.keywords, ...(l.points ?? []), ...(l.scenes ?? [])].join(" ").normalize("NFKC").includes(w)),
  );
  return (
    <section className="screen">
      <h1 className="screen-title">法令・基準</h1>
      <div className="hint">
        現場でよく使う条文{laws ? ` ${laws.length}件` : ""}。場面を選ぶか、言葉で探してください。
        <details className="more-info">
          <summary>？ どの法令から</summary>
          電気設備の技術基準の解釈（電技解釈）・電気設備に関する技術基準を定める省令（電技省令）・電気工事士法・建設業法施行令・公共建築工事標準仕様書（標準仕様書）から収めています。
        </details>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="言葉で探す（例: PF 支持 / 接地 / 軽微）" />
      <p className="hint">場面で探す</p>
      <div className="tiles scene-tiles">
        {LAW_SCENES.map((x) => (
          <Tile key={x.label} icon={x.icon} label={x.label} on={scene === x.label} onClick={() => setScene(scene === x.label ? null : x.label)} />
        ))}
      </div>
      {meant.map((t) => (
        <div key={t.term} className="gloss-box">
          <p className="part-sub">📖 言葉の意味：{t.term}</p>
          <Meanings term={t} onLaw={setOpen} />
        </div>
      ))}
      {laws === null && (failed ? <LoadFailed what="条文" onRetry={() => setTries((n) => n + 1)} /> : (s || words.length > 0) && <Skeleton />)}
      {laws && !s && !words.length && !all && (
        <button className="link" onClick={() => setAll(true)}>
          すべての条文を見る（{laws.length}件）
        </button>
      )}
      {laws && (s || words.length > 0 || all) && <p className="hint">{shown.length}件</p>}
      {laws && shown.length === 0 && <p className="empty">合う条文がありません。言葉や場面を変えてみてください。</p>}
      {(s || words.length > 0 || all ? shown : []).map((l) => (
        <button key={l.id} className="card-row law-row" onClick={() => setOpen(l.id)}>
          <strong>{l.heading}</strong>
          {l.points?.[0] && <span className="law-gist">{l.points[0]}</span>}
          {l.scenes?.[0] && <span className="src-meta">こんな時：{l.scenes[0]}</span>}
          <span className="law-no">
            {l.short} {l.article} ›
          </span>
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
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    setFailed(false);
    return onSnapshot(
      query(collection(db, "cards"), where("companyId", "in", spaces()), where("status", "==", "published")),
      (snap) =>
        setCards(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Card, "id">) }))
            .sort((a, b) => (b.publishedAt?.toMillis() ?? 0) - (a.publishedAt?.toMillis() ?? 0)),
        ),
      () => setFailed(true),
    );
  }, [tries]);

  const [q, setQ] = useState("");
  const words = wordsOf(q);
  const shown =
    cards?.filter(
      (c) =>
        (!filter || c[filter.kind] === filter.value) &&
        words.every((w) => [c.title, c.scene, c.body, c.reason, c.caution, ...(c.tags ?? [])].join(" ").normalize("NFKC").includes(w)),
    ) ?? [];
  const people = useMemo(() => veterans(cards ?? []), [cards]);
  const [person, setPerson] = useState<string | null>(null);
  const who = people.find((p) => p.name === person);

  if (open) {
    return (
      <section className="screen">
        <button className="link" onClick={() => setOpen(null)}>
          {who ? `← ${who.name}さんのページへ` : "← 一覧へ"}
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

  if (who) {
    return (
      <section className="screen">
        <button className="link" onClick={() => setPerson(null)}>
          ← 一覧へ
        </button>
        <div className="vet-page">
          <p className="vet-name">🧰 {who.name}</p>
          <div className="vet-stats">
            <span>
              <strong>👍 {who.helped}</strong>回 助けた
            </span>
            <span>
              <strong>{who.cards.length}</strong>枚の知恵
            </span>
            <span>
              <strong>{who.answered}</strong>件の質問に答えた
            </span>
          </div>
        </div>
        <p className="hint">この人の知恵カード</p>
        {who.cards.map((c) => (
          <button key={c.id} className="card-row" onClick={() => setOpen(c)}>
            <strong>
              <Icon of={CATEGORY_ICON[c.category] ?? ic("cards")} /> {c.title}
            </strong>
            <span className="src-meta">
              👍 {c.helpedCount}
              {c.triggerAskerName ? `・${c.triggerAskerName}さんの質問に答えた` : ""}・{fmtDate(c.publishedAt?.toMillis())}
            </span>
          </button>
        ))}
      </section>
    );
  }

  return (
    <section className="screen">
      <h1 className="screen-title">知恵カードを探す</h1>
      {people.length > 0 && (
        <div className="vet-rank">
          <p className="vet-rank-head">🏅 よく助けてくれた親方</p>
          <div className="vet-podium">
            {people.slice(0, 3).map((p, i) => (
              <button key={p.name} className="vet-medal-card" onClick={() => setPerson(p.name)}>
                <span className="vet-medal" aria-label={`${i + 1}位`}>
                  {MEDALS[i]}
                </span>
                <strong>{p.name}</strong>
                <span className="src-meta">👍 {p.helped}</span>
                <span className="src-meta">カード{p.cards.length}枚</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="言葉で探す（例: PF 曲げ / 脚立）" />
      <p className="hint">場所</p>
      <div className="tiles">
        {Object.entries(LOCATION_LABEL).map(([k, v]) => (
          <Tile key={k} icon={LOCATION_ICON[k]} label={v} on={filter?.kind === "location" && filter.value === k} onClick={() => setFilter(filter?.value === k ? null : { kind: "location", value: k })} />
        ))}
      </div>
      <p className="hint">種類</p>
      <div className="tiles">
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <Tile key={k} icon={CATEGORY_ICON[k]} label={v} on={filter?.kind === "category" && filter.value === k} onClick={() => setFilter(filter?.value === k ? null : { kind: "category", value: k })} />
        ))}
      </div>
      {cards === null && (failed ? <LoadFailed what="知恵カード" onRetry={() => setTries((n) => n + 1)} /> : <Skeleton />)}
      {cards && shown.length === 0 && <p className="empty">{cards.length ? "合う知恵カードがありません。言葉や絞り込みを変えてみてください。" : "まだカードがありません。"}</p>}
      {shown.map((c) => (
        <button key={c.id} className="card-row" onClick={() => setOpen(c)}>
          <strong>
              <Icon of={CATEGORY_ICON[c.category] ?? ic("cards")} /> {c.title}
            </strong>
          <span className="src-meta">
            {authorOf(c)}・👍 {c.helpedCount}
          </span>
        </button>
      ))}
    </section>
  );
}

/**
 * The veterans who chose to show their name, most 👍 first. A card published without the name is never counted
 * for anyone: adding it to a person would tell whose it is.
 */
function veterans(cards: Card[]) {
  const by = new Map<string, Card[]>();
  for (const c of cards) {
    if (!c.showAuthorName || !c.authorName) continue;
    by.set(c.authorName, [...(by.get(c.authorName) ?? []), c]);
  }
  return [...by.entries()]
    .map(([name, list]) => ({
      name,
      cards: [...list].sort((a, b) => b.helpedCount - a.helpedCount),
      helped: list.reduce((t, c) => t + (c.helpedCount ?? 0), 0),
      answered: list.filter((c) => c.triggerAskerName).length,
    }))
    .sort((a, b) => b.helped - a.helped || b.cards.length - a.cards.length);
}

function Part({ label, text }: { label: string; text: string }) {
  return (
    <div className="wc-part">
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function Tile({ icon, label, on, onClick }: { icon?: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`tile ${icon ? "icon-tile" : ""} ${on ? "on" : ""}`} onClick={onClick}>
      {icon && (
        <Icon of={icon} className="tile-icon" />
      )}
      <span>{label}</span>
    </button>
  );
}
