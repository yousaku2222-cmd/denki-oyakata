import { useState } from "react";
import { LawSheet } from "./LawSheet";

export interface CalcOutput {
  name: string;
  title: string;
  ok: boolean | null;
  verdict: string;
  steps: string[];
  notes: string[];
  basisShown: { lawId: string; quote: string; label: string; edition: string }[];
  figure?: { kind: "fill"; innerDiameter: number; wires: { label: string; diameter: number; count: number }[] };
}

/** Result of a calculation done by code: verdict, the working, the basis (checked quotes), and a figure. */
export function CalcCard({ c }: { c: CalcOutput }) {
  const [open, setOpen] = useState<{ id: string; quote: string } | null>(null);
  const tone = c.ok === null ? "info" : c.ok ? "pass" : "fail";
  return (
    <div className={`calc-card ${tone}`}>
      <span className="src-tag">🧮 計算・判定（プログラムで計算）</span>
      <p className="calc-title">{c.title}</p>
      <p className="calc-verdict">
        {c.ok === true && "✅ "}
        {c.ok === false && "❌ "}
        {c.verdict}
      </p>
      {c.figure?.kind === "fill" && <FillFigure f={c.figure} />}
      <details>
        <summary>計算の過程</summary>
        <ol className="calc-steps">
          {c.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>
      {c.basisShown.map((b, i) => (
        <button key={i} className="law-cite" onClick={() => setOpen({ id: b.lawId, quote: b.quote })}>
          <span className="src-tag law">⚖️ 根拠</span>
          <q>{b.quote}</q>
          <span className="src-meta">
            {b.label}・{b.edition} ›
          </span>
          <span className="stamp small">✔ 原文と一致</span>
        </button>
      ))}
      {c.notes.map((n, i) => (
        <p key={i} className="hint">
          ※ {n}
        </p>
      ))}
      {open && <LawSheet id={open.id} highlight={open.quote} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Cross section of the conduit with the wires packed in rings (a picture, not a packing proof).
function FillFigure({ f }: { f: NonNullable<CalcOutput["figure"]> }) {
  const R = 100;
  const scale = (2 * R) / f.innerDiameter;
  const circles: { r: number; color: string }[] = [];
  const colors = ["#e0302b", "#2a6ad8", "#f5c400"];
  f.wires.forEach((w, i) => {
    for (let k = 0; k < w.count; k++) circles.push({ r: (w.diameter * scale) / 2, color: colors[i % colors.length] });
  });
  circles.sort((a, b) => b.r - a.r);
  // place on rings from the outside in
  const placed: { x: number; y: number; r: number; color: string }[] = [];
  for (const c of circles) {
    let done = false;
    for (let ring = R - c.r; ring >= 0 && !done; ring -= c.r * 0.9) {
      const steps = ring === 0 ? 1 : Math.max(1, Math.floor((2 * Math.PI * ring) / (c.r * 0.6)));
      for (let s = 0; s < steps && !done; s++) {
        const t = (2 * Math.PI * s) / steps;
        const x = ring * Math.cos(t);
        const y = ring * Math.sin(t);
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + c.r - 0.5)) {
          placed.push({ x, y, r: c.r, color: c.color });
          done = true;
        }
      }
    }
    if (!done) placed.push({ x: 0, y: 0, r: c.r, color: c.color }); // overflow: draw anyway
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
