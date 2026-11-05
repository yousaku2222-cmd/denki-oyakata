import { useMemo, useState } from "react";
import { LawSheet } from "./LawSheet";

export interface CalcOutput {
  name: string;
  title: string;
  ok: boolean | null;
  verdict: string;
  steps: string[];
  notes: string[];
  basisShown: { lawId: string; quote: string; label: string; edition: string }[];
  figure?:
    | { kind: "fill"; innerDiameter: number; wires: { label: string; diameter: number; count: number }[] }
    | { kind: "rack"; width: number; tiers: { cables: { label: string; x: number; d: number; hv: boolean }[]; barrierAt?: number }[] };
}

/**
 * Result of a calculation done by code: verdict, the working, the basis (checked quotes), and a figure.
 * compact (inside an answer) shows the verdict and keeps the rest behind a tap, so the answer stays short.
 */
export function CalcCard({ c, compact = false }: { c: CalcOutput; compact?: boolean }) {
  const [open, setOpen] = useState<{ id: string; quote: string } | null>(null);
  const tone = c.ok === null ? "info" : c.ok ? "pass" : "fail";
  const detail = <CalcDetail c={c} onCite={setOpen} foldSteps={!compact} />;
  return (
    <div className={`calc-card ${tone}`}>
      <span className="src-tag">🧮 計算・判定（プログラムで計算）</span>
      <p className="calc-title">{c.title}</p>
      <p className="calc-verdict">
        {c.ok === true && "✅ "}
        {c.ok === false && "❌ "}
        {c.verdict}
      </p>
      {compact ? (
        <details>
          <summary>計算の過程と根拠</summary>
          {detail}
        </details>
      ) : (
        detail
      )}
      {open && <LawSheet id={open.id} highlight={open.quote} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CalcDetail({ c, onCite, foldSteps }: { c: CalcOutput; onCite: (o: { id: string; quote: string }) => void; foldSteps: boolean }) {
  const steps = (
    <ol className="calc-steps">
      {c.steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
  // the program checks the quoted words, not the numbers of a table (146-1表 and the like are typed into the app)
  const fromTable = c.basisShown.length > 0 && c.steps.some((s) => /\d+-\d+表|\d+表の値/.test(s));
  return (
    <>
      {c.figure?.kind === "fill" && <FillFigure f={c.figure} />}
      {c.figure?.kind === "rack" && <RackFigure f={c.figure} />}
      {foldSteps ? (
        <details>
          <summary>計算の過程</summary>
          {steps}
        </details>
      ) : (
        steps
      )}
      {c.basisShown.map((b, i) => (
        <button key={i} className="law-cite" onClick={() => onCite({ id: b.lawId, quote: b.quote })}>
          <span className="src-tag law">⚖️ 根拠</span>
          <q>{b.quote}</q>
          <span className="src-meta">
            {b.label}・{b.edition} ›
          </span>
          <span className="stamp small">✔ 引用文は原文と一致</span>
        </button>
      ))}
      {fromTable && <p className="hint">※ 表の数値は、アプリに入れた値です。原文の表で確かめてください。</p>}
      {c.notes.map((n, i) => (
        <p key={i} className="hint">
          ※ {n}
        </p>
      ))}
    </>
  );
}

// Cross section of the conduit with the wires settled from the bottom, as if dropped in (a picture, not a packing proof).
// Each wire goes to the lowest spot where it touches the pipe wall or the wires already in; bigger wires go in first.
function settle(R: number, circles: { r: number; color: string }[]) {
  const placed: { x: number; y: number; r: number; color: string }[] = [];
  const fits = (x: number, y: number, r: number) =>
    Math.hypot(x, y) <= R - r + 0.01 && placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r - 0.01);
  // the points at distance a from (x1,y1) and b from (x2,y2)
  const meet = (x1: number, y1: number, a: number, x2: number, y2: number, b: number) => {
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d === 0 || d > a + b || d < Math.abs(a - b)) return [];
    const l = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - l * l));
    const mx = x1 + ((x2 - x1) * l) / d;
    const my = y1 + ((y2 - y1) * l) / d;
    return [
      { x: mx + ((y2 - y1) * h) / d, y: my - ((x2 - x1) * h) / d },
      { x: mx - ((y2 - y1) * h) / d, y: my + ((x2 - x1) * h) / d },
    ];
  };
  for (const c of circles) {
    const wall = R - c.r;
    const cands: { x: number; y: number }[] = [];
    for (let k = 0; k <= 180; k++) {
      const t = (Math.PI * k) / 180; // lower half of the wall (SVG y points down)
      cands.push({ x: wall * Math.cos(t), y: wall * Math.sin(t) });
    }
    placed.forEach((p, i) => {
      cands.push(...meet(0, 0, wall, p.x, p.y, p.r + c.r));
      for (let j = i + 1; j < placed.length; j++) cands.push(...meet(p.x, p.y, p.r + c.r, placed[j].x, placed[j].y, placed[j].r + c.r));
    });
    let best: { x: number; y: number } | null = null;
    for (const q of cands) {
      if (!fits(q.x, q.y, c.r)) continue;
      if (!best || q.y > best.y + 1e-6 || (Math.abs(q.y - best.y) <= 1e-6 && Math.abs(q.x) < Math.abs(best.x))) best = q;
    }
    placed.push({ ...(best ?? { x: 0, y: 0 }), r: c.r, color: c.color }); // no room left: draw anyway
  }
  return placed;
}

// settle() grows roughly with the cube of the wire count (468 wires took 10 s on a PC): draw at most this many
const MAX_DRAWN = 120;

function FillFigure({ f }: { f: Extract<NonNullable<CalcOutput["figure"]>, { kind: "fill" }> }) {
  const R = 100;
  const total = f.wires.reduce((n, w) => n + w.count, 0);
  const placed = useMemo(() => {
    if (total > MAX_DRAWN) return [];
    const scale = (2 * R) / f.innerDiameter;
    const colors = ["#e0302b", "#2a6ad8", "#f5c400"];
    const circles: { r: number; color: string }[] = [];
    f.wires.forEach((w, i) => {
      for (let k = 0; k < w.count; k++) circles.push({ r: (w.diameter * scale) / 2, color: colors[i % colors.length] });
    });
    circles.sort((a, b) => b.r - a.r);
    return settle(R, circles);
  }, [f, total]);
  if (total > MAX_DRAWN) {
    return <p className="hint">電線が {total} 本と多いので、断面の図は省きます（{MAX_DRAWN} 本までは図を出します）。</p>;
  }
  return (
    <figure className="fill-fig">
      <svg viewBox="-110 -110 220 220" role="img" aria-label="管の断面と電線">
        <circle r={R + 6} fill="#9aa3b5" />
        <circle r={R} fill="var(--surface)" />
        {placed.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.color} stroke="#111" strokeWidth="1" opacity="0.9" />
        ))}
      </svg>
      <figcaption>
        内径 {f.innerDiameter}mm／{f.wires.map((w) => `${w.label}×${w.count}`).join("＋")}
      </figcaption>
    </figure>
  );
}

// Cross section of the rack: each tier is a tray with the cables in one row (high voltage in red, low voltage in blue).
function RackFigure({ f }: { f: Extract<NonNullable<CalcOutput["figure"]>, { kind: "rack" }> }) {
  const W = 300;
  const k = W / f.width;
  const tallest = Math.max(10, ...f.tiers.flatMap((t) => t.cables.map((c) => c.d))) * k;
  const tierH = tallest + 26;
  const H = tierH * f.tiers.length + 8;
  return (
    <figure className="fill-fig rack">
      <svg viewBox={`-14 -4 ${W + 28} ${H + 18}`} role="img" aria-label="ケーブルラックの断面とケーブル">
        {f.tiers.map((t, i) => {
          const floor = tierH * (i + 1);
          return (
            <g key={i}>
              <path d={`M-6 ${floor - tallest - 10} V${floor} H${W + 6} V${floor - tallest - 10}`} fill="none" stroke="#9aa3b5" strokeWidth="5" />
              {t.cables.map((c, j) => (
                <circle key={j} cx={(c.x + c.d / 2) * k} cy={floor - 2.5 - (c.d * k) / 2} r={(c.d * k) / 2} fill={c.hv ? "#e0302b" : "#2a6ad8"} stroke="#111" strokeWidth="0.8" opacity="0.9" />
              ))}
              {t.barrierAt !== undefined && <line x1={t.barrierAt * k} x2={t.barrierAt * k} y1={floor - tallest - 6} y2={floor} stroke="#f5c400" strokeWidth="3" />}
            </g>
          );
        })}
        <text x={W / 2} y={H + 12} textAnchor="middle" fontSize="12" fill="currentColor">
          幅 {f.width}mm
        </text>
      </svg>
      <figcaption>赤＝高圧、青＝低圧{f.tiers.some((t) => t.barrierAt !== undefined) ? "、黄＝隔壁" : ""}</figcaption>
    </figure>
  );
}
