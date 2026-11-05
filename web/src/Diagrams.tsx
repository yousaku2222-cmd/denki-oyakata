import { useId } from "react";
import type { Sentence } from "./components";
import { lawTitle, type LawRef } from "./LawSheet";
import type { CalcOutput } from "./CalcCard";
import { BEND_FACTS, SUPPORT_FACTS, factFor, type BendFact, type SupportFact } from "./diagramFacts";

// 「図で見る」: pictures drawn by the program (SVG), never by the AI. A law figure uses only the numbers of
// diagramFacts.ts (checked against the original in functions/src/diagrams.test.ts), and only when a law sentence
// of the answer quotes that rule and the quote matched the original. The voltage drop figure uses the
// calculation's own values. Nothing is shown for any other answer.

type Shown = { sentences: Sentence[]; laws?: LawRef[]; calcs?: CalcOutput[] };

export function AnswerDiagrams({ answer }: { answer: Shown }) {
  const bends: BendFact[] = [];
  const supports: SupportFact[] = [];
  for (const s of answer.sentences) {
    if (s.source !== "law" || !s.verified || !s.lawId || !s.quote) continue;
    const b = factFor(BEND_FACTS, s.lawId, s.quote);
    if (b && !bends.includes(b)) bends.push(b);
    const p = factFor(SUPPORT_FACTS, s.lawId, s.quote);
    if (p && !supports.includes(p)) supports.push(p);
  }
  const drops = (answer.calcs ?? []).flatMap((c) => {
    const d = readDrop(c);
    return d ? [d] : [];
  });
  if (!bends.length && !supports.length && !drops.length) return null;
  const fromLaw = bends.length > 0 || supports.length > 0;
  const name = (id: string) => {
    const l = answer.laws?.find((x) => x.id === id);
    return l ? lawTitle(l) : id;
  };
  return (
    <section className="diagrams" aria-label="図で見る">
      <p className="diagrams-head">
        📐 図で見る<span>（{fromLaw ? (drops.length ? "条文の数値と計算の値" : "条文の数値") : "計算の値"}からアプリが描いた図）</span>
      </p>
      {bends.length > 0 && <BendFigure facts={bends} name={name} />}
      {supports.length > 0 && <SupportFigure facts={supports.slice(0, 3)} name={name} />}
      {drops.map((d, i) => (
        <DropFigure key={i} d={d} />
      ))}
    </section>
  );
}

/** Where the numbers came from: the words of the original, under the figure. */
function Sources({ facts, name }: { facts: { lawId: string; sources: string[] }[]; name: (id: string) => string }) {
  return (
    <p className="dg-source">
      数値の出どころ:{" "}
      {facts.map((f, i) => (
        <span key={f.lawId}>
          {i > 0 && "／"}
          {name(f.lawId)}「{f.sources.join("…")}」
        </span>
      ))}
    </p>
  );
}

// One run from box to box with as many 90° bends as the total allows (3 × 90° = 270°), then a few examples judged
// against the rule. The example angles are only examples; the limits are the article's.
function BendFigure({ facts, name }: { facts: BendFact[]; name: (id: string) => string }) {
  const { bends, total, each } = facts[0]; // the three articles have the same numbers (checked in the test)
  const n = Math.floor(total / each); // bends of the largest angle that fit in the total
  const judge = (angles: number[]) => {
    const sum = angles.reduce((a, b) => a + b, 0);
    const why = angles.length > bends ? `${bends}か所を超える` : sum > total ? `合計が${total}°を超える` : "";
    return { sum, ok: !why, why };
  };
  const examples = [
    { label: `${each}°×${n}`, angles: Array(n).fill(each) as number[] },
    { label: `${each}°×${n}＋45°`, angles: [...(Array(n).fill(each) as number[]), 45] },
    { label: `45°×${bends + 1}`, angles: Array(bends + 1).fill(45) as number[] },
  ].map((e) => ({ ...e, ...judge(e.angles) }));
  const pipes = [...new Set(facts.map((f) => f.pipe))].join("・");
  return (
    <figure className="dg">
      <p className="dg-title">配管の曲げ（{pipes}）</p>
      <svg viewBox="0 0 340 150" role="img" aria-label={`ボックスからボックスまでの1区間に、${each}度の曲げが${n}か所、合計${n * each}度の配管の図。1区間の曲げは${bends}か所以下、曲げ角度の合計は${total}度まで。`}>
        <rect className="dg-box" x="8" y="14" width="34" height="34" rx="3" />
        <text className="dg-small" x="25" y="64" textAnchor="middle">ボックス</text>
        <rect className="dg-box" x="254" y="14" width="34" height="34" rx="3" />
        <text className="dg-small" x="271" y="9" textAnchor="middle">ボックス</text>
        <path className="dg-pipe" d="M42 31 H92 Q112 31 112 51 V100 Q112 120 132 120 H251 Q271 120 271 100 V48" />
        {[
          [112, 31, 128, 30],
          [112, 120, 92, 140],
          [271, 120, 300, 140],
        ].map(([cx, cy, tx, ty], i) => (
          <g key={i}>
            <circle className="dg-mark" cx={cx} cy={cy} r="7" />
            <text className="dg-mark-n" x={cx} y={cy + 4} textAnchor="middle">{i + 1}</text>
            <text className="dg-small" x={tx} y={ty} textAnchor="middle">{each}°</text>
          </g>
        ))}
        <text className="dg-big" x="192" y="72" textAnchor="middle">1区間</text>
        <text className="dg-small" x="192" y="92" textAnchor="middle">{`${each}°×${n}＝${n * each}°`}</text>
      </svg>
      <p className="dg-rule">
        曲げ <strong>{bends}か所以下</strong>／合計 <strong>{total}°まで</strong>（1区間）
      </p>
      <ul className="dg-examples">
        {examples.map((e) => (
          <li key={e.label} className={e.ok ? "ok" : "ng"}>
            {e.label}＝{e.sum}° {e.ok ? "✅" : `❌ ${e.why}`}
          </li>
        ))}
      </ul>
      <p className="dg-note">1か所の曲げは{each}°まで。</p>
      <Sources facts={facts} name={name} />
    </figure>
  );
}

// A pipe on the wall from a box, held by saddles: the first one near the box, then one span with its length.
// The spans are drawn to one scale, so 1m looks shorter than 1.5m when two pipes are shown together.
const PX_PER_M = 110;
function SupportFigure({ facts, name }: { facts: SupportFact[]; name: (id: string) => string }) {
  const arrow = useId(); // one marker per figure: ids must not repeat on the page
  const ROW = 80;
  const label = facts.map((f) => `${f.pipe}は${f.meters}m以下`).join("、");
  return (
    <figure className="dg">
      <p className="dg-title">管の支持の間隔</p>
      <svg viewBox={`0 0 340 ${ROW * facts.length + 6}`} role="img" aria-label={`ボックスから出た管を、サドルで留める間隔の図。${label}。ボックスの近くにもサドルを付ける。`}>
        {facts.map((f, i) => {
          const y = ROW * i + 44; // the pipe's center line
          const a = 56; // the saddle near the box
          const b = a + f.meters * PX_PER_M;
          return (
            <g key={f.lawId}>
              <text className="dg-small" x="8" y={y - 30}>{f.pipe}</text>
              <rect className="dg-box" x="8" y={y - 15} width="26" height="30" rx="3" />
              <line className="dg-pipe thin" x1="34" y1={y} x2="332" y2={y} />
              {[a, b].map((x) => (
                <path key={x} className="dg-saddle" d={`M${x - 9} ${y + 9} V${y - 3} Q${x - 9} ${y - 9} ${x} ${y - 9} Q${x + 9} ${y - 9} ${x + 9} ${y - 3} V${y + 9}`} />
              ))}
              <line className="dg-dim" x1={a} y1={y + 18} x2={b} y2={y + 18} markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} />
              <text className="dg-dim-t" x={(a + b) / 2} y={y + 36} textAnchor="middle">{f.meters}m以下</text>
            </g>
          );
        })}
        <defs>
          <marker id={arrow}viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="dg-arrow" d="M0 0 L10 5 L0 10 z" />
          </marker>
        </defs>
      </svg>
      <p className="dg-note">ボックスとの接続点や管の端の近くでも留めます。</p>
      <Sources facts={facts} name={name} />
    </figure>
  );
}

// ---------- 電圧降下: the values the calculation (functions/src/calc/electrical.ts voltageDrop) wrote in its steps ----------
interface Drop {
  V: number; // 基準の電圧
  L: number; // こう長（片道）m
  I: number; // 負荷電流 A
  e: number; // この区間の降下 V
  pct: number;
  limit: number; // こう長に応じた目安 %
  totalPct: number | null; // この区間以外の降下も足した %（入れた時だけ）
  ok: boolean;
}
const n = (s: string) => Number(s.replace(/,/g, "")); // fmt() writes 1,200
/** Read back from the steps of the voltage drop card; a card it cannot read gets no figure (never a guess). */
function readDrop(c: CalcOutput): Drop | null {
  if (c.name !== "voltage_drop") return null;
  const find = (re: RegExp) => c.steps.map((s) => s.match(re)).find(Boolean) ?? null;
  const calc = find(/^e = [\d.]+ × ([\d,.]+) × ([\d,.]+) ÷ \(1000 × [\d,.]+\) = ([\d,.]+)V$/);
  const of = find(/^([\d,.]+)V に対して ([\d,.]+)%/);
  const lim = find(/^電圧降下の目安: こう長 [\d,.]+m → (?:幹線と分岐回路の合計で )?(\d+)%以内.*… ([○×])$/);
  if (!calc || !of || !lim) return null;
  const total = find(/^この区間以外の降下 .*（([\d,.]+)%）$/);
  const L = n(calc[1]);
  // up to 60m each section has its own limit: the total is drawn only where the guideline means it (as voltageDrop)
  const d = { L, I: n(calc[2]), e: n(calc[3]), V: n(of[1]), pct: n(of[2]), limit: n(lim[1]), totalPct: total && L > 60 ? n(total[1]) : null, ok: lim[2] === "○" };
  return Object.values(d).every((v) => v === null || typeof v === "boolean" || Number.isFinite(v)) ? d : null;
}

/** The drop figure on a calculation card (計算 screen); nothing for other calculations. */
export function CalcDiagram({ c }: { c: CalcOutput }) {
  const d = readDrop(c);
  return d ? <DropFigure d={d} /> : null;
}

// 電源 → こう長 → 負荷, and a bar of the drop against the guideline's limit.
function DropFigure({ d }: { d: Drop }) {
  const arrow = useId();
  const at = Math.round((d.V - d.e) * 10) / 10;
  const shown = d.totalPct ?? d.pct;
  const top = Math.max(d.limit * 1.5, shown * 1.1); // the bar's full width in %
  const X0 = 20;
  const W = 300;
  const x = (p: number) => X0 + (Math.min(p, top) / top) * W;
  const bars = [{ label: "この区間", p: d.pct }, ...(d.totalPct !== null ? [{ label: "合計", p: d.totalPct }] : [])];
  return (
    <figure className="dg">
      <p className="dg-title">電圧降下</p>
      <svg
        viewBox={`0 0 340 ${150 + bars.length * 26}`}
        role="img"
        aria-label={`電源${d.V}Vから負荷まで、こう長${d.L}m、負荷電流${d.I}Aの図。電圧降下は${d.e}V、${d.pct}%${d.totalPct !== null ? `（この区間より手前の降下も足すと合計${d.totalPct}%）` : ""}。負荷側はおよそ${at}V。目安は${d.limit}%以内で、${d.ok ? "目安の中に収まっています" : "目安を超えています"}。`}
      >
        <rect className="dg-box" x="8" y="34" width="70" height="52" rx="6" />
        <text className="dg-big" x="43" y="56" textAnchor="middle">電源</text>
        <text className="dg-small" x="43" y="76" textAnchor="middle">{d.V}V</text>
        <rect className="dg-box" x="262" y="34" width="70" height="52" rx="6" />
        <text className="dg-big" x="297" y="56" textAnchor="middle">負荷</text>
        <text className="dg-small" x="297" y="76" textAnchor="middle">{d.I}A</text>
        <line className="dg-pipe thin" x1="78" y1="50" x2="262" y2="50" />
        <line className="dg-pipe thin" x1="78" y1="70" x2="262" y2="70" />
        <line className="dg-dim" x1="80" y1="20" x2="260" y2="20" markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} />
        <text className="dg-dim-t" x="170" y="15" textAnchor="middle">こう長 {d.L}m</text>
        <text className="dg-small" x="170" y="102" textAnchor="middle">{`${d.e}V 下がる → 負荷側 約${at}V`}</text>
        {bars.map((b, i) => {
          const y = 126 + i * 26;
          const over = b.p > d.limit;
          return (
            <g key={b.label}>
              <text className="dg-small" x={X0} y={y - 6}>{`${b.label} ${b.p}%`}</text>
              <rect className="dg-track" x={X0} y={y} width={W} height="10" rx="5" />
              <rect className={`dg-bar ${over ? "ng" : "ok"}`} x={X0} y={y} width={Math.max(4, x(b.p) - X0)} height="10" rx="5" />
            </g>
          );
        })}
        <line className="dg-limit" x1={x(d.limit)} y1="112" x2={x(d.limit)} y2={140 + (bars.length - 1) * 26} />
        <text className="dg-small" x={x(d.limit)} y={152 + (bars.length - 1) * 26} textAnchor="middle">目安 {d.limit}%</text>
        <defs>
          <marker id={arrow}viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="dg-arrow" d="M0 0 L10 5 L0 10 z" />
          </marker>
        </defs>
      </svg>
      <p className="dg-rule">
        {d.totalPct !== null ? "合計の降下" : "降下"} <strong>{shown}%</strong>
        {d.totalPct === null && `（${d.e}V）`}／目安 <strong>{d.limit}%以内</strong> {d.ok ? "✅" : "❌"}
      </p>
      <p className="dg-source">値は上の計算（プログラム）のものです。目安は内線規程の考え方です。</p>
    </figure>
  );
}
