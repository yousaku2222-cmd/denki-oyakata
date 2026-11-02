import { Calc, CalcInputError, Field, fmt, num, pick } from "./types";

// Conductor sizes offered in the forms. Solid wires are given by diameter (mm), stranded by cross section (mm²).
export const CONDUCTORS: Record<string, { label: string; area: number; solidDia?: number }> = {
  "1.6": { label: "1.6mm（単線）", area: (Math.PI * 1.6 ** 2) / 4, solidDia: 1.6 },
  "2.0": { label: "2.0mm（単線）", area: (Math.PI * 2.0 ** 2) / 4, solidDia: 2.0 },
  "2.6": { label: "2.6mm（単線）", area: (Math.PI * 2.6 ** 2) / 4, solidDia: 2.6 },
  "3.2": { label: "3.2mm（単線）", area: (Math.PI * 3.2 ** 2) / 4, solidDia: 3.2 },
  "2sq": { label: "2sq（より線）", area: 2 },
  "3.5sq": { label: "3.5sq", area: 3.5 },
  "5.5sq": { label: "5.5sq", area: 5.5 },
  "8sq": { label: "8sq", area: 8 },
  "14sq": { label: "14sq", area: 14 },
  "22sq": { label: "22sq", area: 22 },
  "38sq": { label: "38sq", area: 38 },
  "60sq": { label: "60sq", area: 60 },
  "100sq": { label: "100sq", area: 100 },
  "150sq": { label: "150sq", area: 150 },
};
const conductorField = (key: string, label: string, def: string): Field => ({
  key,
  label,
  type: "select",
  default: def,
  options: Object.entries(CONDUCTORS).map(([value, c]) => ({ value, label: c.label })),
});

// ---------- 電圧降下（銅線の簡略式） ----------
const SYSTEMS = {
  single2: { label: "単相2線式", k: 35.6, v: 100, note: "線間の電圧降下" },
  single3: { label: "単相3線式（外線と中性線の間）", k: 17.8, v: 100, note: "外線と中性線の間の電圧降下（平衡負荷）" },
  three3: { label: "三相3線式", k: 30.8, v: 200, note: "線間の電圧降下" },
} as const;
const vd = {
  system: { key: "system", label: "配電方式", type: "select", default: "single2", options: Object.entries(SYSTEMS).map(([value, s]) => ({ value, label: s.label })) },
  length: { key: "length", label: "こう長（片道）", type: "number", unit: "m", min: 0.1, max: 2000 },
  current: { key: "current", label: "負荷電流", type: "number", unit: "A", min: 0.1, max: 2000 },
  conductor: conductorField("conductor", "電線の太さ", "2.0"),
  voltage: { key: "voltage", label: "基準の電圧（%の計算に使う）", type: "number", unit: "V", min: 1, help: "空欄なら単相100V・三相200V" },
} satisfies Record<string, Field>;

export const voltageDrop: Calc = {
  name: "voltage_drop",
  label: "電圧降下",
  description: "銅線の電圧降下を簡略式（e = K×L×I ÷ (1000×A)、K=35.6/17.8/30.8）で計算し、電圧に対する%も出す。",
  fields: Object.values(vd),
  run(p) {
    const s = SYSTEMS[pick<keyof typeof SYSTEMS>(p, vd.system)];
    const L = num(p, vd.length);
    const I = num(p, vd.current);
    const c = CONDUCTORS[pick(p, vd.conductor)];
    const V = p.voltage === undefined || p.voltage === "" ? s.v : num(p, vd.voltage);
    const e = (s.k * L * I) / (1000 * c.area);
    const pct = (e / V) * 100;
    return {
      title: `電圧降下（${s.label}）`,
      ok: null,
      verdict: `${fmt(e)}V（${fmt(pct, 1)}%）`,
      steps: [
        `式: e = ${s.k} × L × I ÷ (1000 × A)`,
        `電線 ${c.label} → 断面積 A = ${fmt(c.area)}mm²`,
        `e = ${s.k} × ${fmt(L)} × ${fmt(I)} ÷ (1000 × ${fmt(c.area)}) = ${fmt(e)}V`,
        `${V}V に対して ${fmt(pct, 1)}%（${s.note}）`,
      ],
      basis: [],
      notes: ["銅線の簡略式です（力率・リアクタンスは考えていません）。", "許される電圧降下（何%まで）は、こう長や幹線・分岐で決まりがあります。社内の決まり・設計図書を確認してください。"],
    };
  },
};

// ---------- 電線の許容電流（電技解釈 第146条） ----------
// 146-1表 / 146-2表（軟銅線又は硬銅線）。値は解釈の原文の表から。
const SOLID: [number, number, number][] = [
  [1.0, 1.2, 16], [1.2, 1.6, 19], [1.6, 2.0, 27], [2.0, 2.6, 35], [2.6, 3.2, 48], [3.2, 4.0, 62], [4.0, 5.0, 81], [5.0, 5.0001, 107],
];
const STRANDED: [number, number, number][] = [
  [0.9, 1.25, 17], [1.25, 2, 19], [2, 3.5, 27], [3.5, 5.5, 37], [5.5, 8, 49], [8, 14, 61], [14, 22, 88], [22, 30, 115], [30, 38, 139],
  [38, 50, 162], [50, 60, 190], [60, 80, 217], [80, 100, 257], [100, 125, 298], [125, 150, 344], [150, 200, 395], [200, 250, 469],
];
// 146-3表: 補正係数 = √((T − θ) / 30)、θ は周囲温度（30℃以下は30）
const INSULATION = {
  vinyl: { label: "ビニル（IV など）", t: 60 },
  heatVinyl: { label: "耐熱ビニル（HIV など）・架橋しないポリエチレン", t: 75 },
  xlpe: { label: "架橋ポリエチレン（IC など）", t: 90 },
} as const;
// 146-4表: 同一管内の電線数 → 電流減少係数
export function reductionFactor(n: number): number {
  if (n <= 3) return 0.7;
  if (n === 4) return 0.63;
  if (n <= 6) return 0.56;
  if (n <= 15) return 0.49;
  if (n <= 40) return 0.43;
  if (n <= 60) return 0.39;
  return 0.34;
}

const amp = {
  conductor: conductorField("conductor", "電線の太さ", "2.0"),
  insulation: { key: "insulation", label: "絶縁体", type: "select", default: "vinyl", options: Object.entries(INSULATION).map(([value, s]) => ({ value, label: s.label })) },
  ambient: { key: "ambient", label: "周囲温度", type: "number", unit: "℃", default: 30, min: -20, max: 59 },
  inConduit: { key: "inConduit", label: "同じ管に入れる電線の本数（管に入れないなら0）", type: "number", unit: "本", default: 0, min: 0, max: 200 },
  load: { key: "load", label: "流す電流（空欄なら許容電流だけ）", type: "number", unit: "A", min: 0 },
} satisfies Record<string, Field>;

export const ampacity: Calc = {
  name: "wire_ampacity",
  label: "電線の許容電流",
  description: "600Vビニル絶縁電線などの許容電流を電技解釈第146条（146-1〜146-4表）で計算し、流す電流が収まるか判定する。ケーブル（VVF・CV）は対象外。",
  fields: Object.values(amp),
  run(p) {
    const c = CONDUCTORS[pick(p, amp.conductor)];
    const ins = INSULATION[pick<keyof typeof INSULATION>(p, amp.insulation)];
    const theta = Math.max(30, num(p, amp.ambient));
    if (theta >= ins.t) throw new CalcInputError("周囲温度が絶縁体の上限以上です");
    const n = Math.round(num(p, amp.inConduit));
    const table = c.solidDia !== undefined ? SOLID : STRANDED;
    const key = c.solidDia ?? c.area;
    const row = table.find(([lo, hi]) => key >= lo && key < hi);
    if (!row) throw new CalcInputError("この太さは表の範囲外です");
    const base = row[2];
    const k = Math.sqrt((ins.t - theta) / 30);
    const r = n > 0 ? reductionFactor(n) : 1;
    const allowed = base * k * r;
    const hasLoad = p.load !== undefined && p.load !== null && p.load !== "";
    const load = hasLoad ? num(p, amp.load) : null;
    const ok = load === null ? null : load <= allowed;
    return {
      title: `電線の許容電流（${c.label}・${ins.label}）`,
      ok,
      verdict: load === null ? `許容電流 ${fmt(allowed, 1)}A` : `${ok ? "OK" : "NG"}（流す ${fmt(load, 1)}A ${ok ? "≦" : "＞"} 許容 ${fmt(allowed, 1)}A）`,
      steps: [
        `${c.solidDia !== undefined ? "146-1表（単線）" : "146-2表（より線）"}: ${base}A`,
        `補正係数（146-3表）: √((${ins.t} − ${theta}) ÷ 30) = ${fmt(k, 3)}`,
        n > 0 ? `電流減少係数（146-4表・同一管内${n}本）: ${r}` : "管に入れない → 電流減少係数なし",
        `許容電流 = ${base} × ${fmt(k, 3)}${n > 0 ? ` × ${r}` : ""} = ${fmt(allowed, 1)}A`,
      ],
      basis: [
        { lawId: "kaishaku-146", quote: "単線にあっては146-1表に、成形単線又はより線にあっては146-2表にそれぞれ規定する許容電流に、第二号に規定する係数を乗じた値であること。" },
        ...(n > 0 ? [{ lawId: "kaishaku-146", quote: "146-4表に規定する電流減少係数を乗じた値であること。" }] : []),
      ],
      notes: ["許容電流は小数点以下を切り捨てて使うのが一般的です。", "VVF・CV などのケーブルは、メーカーの許容電流表を使ってください。"],
    };
  },
};
