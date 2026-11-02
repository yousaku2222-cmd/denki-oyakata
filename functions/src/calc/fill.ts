import { CONDUITS, WIRES } from "./conduitData";
import { Calc, CalcInputError, Field, fmt, num, pick } from "./types";

// 占有率 = 電線の断面積の合計 ÷ 管の内断面積。平形（VVF）は長径×短径の長方形で数える。
// 基準: 同じ太さの電線だけなら48%、太さが違う電線が混ざるなら32%（内線規程の考え方。本文は載せない）。
const SAME_LIMIT = 48;
const MIXED_LIMIT = 32;

export const wireArea = (w: { d?: number; long?: number; short?: number }) => (w.long && w.short ? w.long * w.short : (Math.PI * (w.d ?? 0) ** 2) / 4);
const conduitArea = (inner: number) => (Math.PI * inner ** 2) / 4;

const wireOptions = () => Object.entries(WIRES).map(([value, w]) => ({ value, label: w.label }));
const conduitTypeOptions = () => Object.entries(CONDUITS).map(([value, c]) => ({ value, label: c.label }));

const f = {
  conduitType: { key: "conduitType", label: "管の種類", type: "select", default: "VE", options: conduitTypeOptions() },
  conduitSize: { key: "conduitSize", label: "管の呼び（空欄なら入る太さを探す）", type: "number", min: 1, max: 200 },
  wire1: { key: "wire1", label: "電線1", type: "select", default: "IV-2.0", options: wireOptions() },
  count1: { key: "count1", label: "電線1の本数", type: "number", unit: "本", default: 3, min: 1, max: 100 },
  wire2: { key: "wire2", label: "電線2（あれば）", type: "select", options: wireOptions() },
  count2: { key: "count2", label: "電線2の本数", type: "number", unit: "本", min: 0, max: 100 },
  wire3: { key: "wire3", label: "電線3（あれば）", type: "select", options: wireOptions() },
  count3: { key: "count3", label: "電線3の本数", type: "number", unit: "本", min: 0, max: 100 },
} satisfies Record<string, Field>;

export const conduitFill: Calc = {
  name: "conduit_fill",
  label: "電線管の占有率",
  description:
    "電線管に入れる電線の断面積の合計が、管の内断面積の何%かを計算する（同じ太さだけなら48%、混在なら32%以下）。管の呼びを省くと、入る一番細い管を探す。「VE22にIV2.0は何本入る？」のように本数を聞かれたら、count1 に試したい本数を入れて何度でも呼んでよい。",
  fields: Object.values(f),
  run(p) {
    const type = pick<string>(p, f.conduitType);
    const conduit = CONDUITS[type];
    const wires: { key: string; count: number }[] = [];
    for (const [w, c] of [[f.wire1, f.count1], [f.wire2, f.count2], [f.wire3, f.count3]] as const) {
      if (!p[w.key]) continue;
      const count = Math.round(num(p, c));
      if (count > 0) wires.push({ key: pick<string>(p, w), count });
    }
    if (!wires.length) throw new CalcInputError("電線を1つ以上選んでください");
    const list = wires.map((w) => ({ ...WIRES[w.key], count: w.count }));
    const total = list.reduce((s, w) => s + wireArea(w) * w.count, 0);
    const mixed = new Set(wires.map((w) => w.key)).size > 1;
    const limit = mixed ? MIXED_LIMIT : SAME_LIMIT;

    const rows = Object.entries(conduit.sizes).map(([size, inner]) => ({ size: Number(size), inner, pct: (total / conduitArea(inner)) * 100 }));
    const wanted = p.conduitSize === undefined || p.conduitSize === null || p.conduitSize === "" ? null : num(p, f.conduitSize);
    const target = wanted === null ? rows.find((r) => r.pct <= limit) : rows.find((r) => r.size === wanted);
    if (wanted !== null && !target) throw new CalcInputError(`${conduit.label}に呼び${wanted}はありません（${rows.map((r) => r.size).join("・")}）`);

    const wireText = list.map((w) => `${w.label}×${w.count}本`).join("＋");
    const steps = [
      ...list.map((w) => `${w.label}: ${w.long ? `${w.long}×${w.short}mm（平形）` : `外径${w.d}mm`} → ${fmt(wireArea(w), 1)}mm² × ${w.count}本`),
      `電線の断面積の合計: ${fmt(total, 1)}mm²`,
      `基準: ${mixed ? "太さが違う電線が混ざる → 32%" : "同じ電線だけ → 48%"}以下`,
      ...rows.map((r) => `${conduit.short}${r.size}（内径${r.inner}mm）: ${fmt(r.pct, 1)}%${r.pct <= limit ? " ○" : " ×"}`),
    ];
    const figureWires = list.map((w) => ({ label: w.label, diameter: w.long && w.short ? Math.sqrt((4 * w.long * w.short) / Math.PI) : w.d!, count: w.count }));

    if (!target) {
      return {
        title: `電線管の占有率（${wireText}）`,
        ok: false,
        verdict: `${conduit.label}では、どの太さでも${limit}%を超えます`,
        steps,
        basis: [],
        notes: notes(),
      };
    }
    const ok = target.pct <= limit;
    return {
      title: `電線管の占有率（${wireText}）`,
      ok,
      verdict:
        wanted === null
          ? `${conduit.short}${target.size} 以上（占有率 ${fmt(target.pct, 1)}% ≦ ${limit}%）`
          : `${ok ? "入ります" : "入りません"}（${conduit.short}${target.size}: ${fmt(target.pct, 1)}% ${ok ? "≦" : "＞"} ${limit}%）`,
      steps,
      basis: [],
      notes: notes(),
      figure: { kind: "fill", innerDiameter: target.inner, wires: figureWires },
    };
  },
};

function notes() {
  return [
    "電線の外径・管の内径は、JIS に基づくメーカー公表の代表値です。製品によって違うことがあります。",
    "32%・48% は内線規程の考え方です（本文は載せていません）。曲げが多い・長い配管では、余裕を持たせてください。",
  ];
}
