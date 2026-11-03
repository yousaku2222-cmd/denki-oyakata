import { Basis, Calc, CalcInputError, Field, flag, fmt, fmtVs, num, pick } from "./types";

// ---------- 電線の種類と太さ ----------
// IV は電技解釈 第146条の表で計算し、CV・CVT はメーカー公表の許容電流（JCS 0168-2 による）を使う。
// 出典: SWCC 総合カタログ「許容電流」 https://www.swcc.co.jp/jpn/products/tec_information/pdf/kyoyou.pdf
//       矢崎エナジーシステム 電力用ケーブル 技術資料 https://www.yazaki-group.com/densen/support/power-cable/index.html
// 2社の値は一致（直埋 CVT 8sq だけ違うので小さい方の 77A）。
type Install = "air" | "duct" | "buried";
const INSTALL: Record<Install, { label: string; base: number }> = {
  air: { label: "気中・暗渠（周囲40℃）", base: 40 },
  duct: { label: "管路（地中）", base: 25 },
  buried: { label: "直埋（地中）", base: 25 },
};
const SIZES = ["5.5", "8", "14", "22", "38", "60", "100", "150", "200", "250", "325"];
type Row = [number | null, number | null, number | null]; // 気中・暗渠, 管路, 直埋（A）。null は資料に値なし
const table = (rows: (Row | null)[]) => Object.fromEntries(SIZES.flatMap((s, i) => (rows[i] ? [[s, rows[i]!]] : []))) as Record<string, Row>;
const CABLE_AMPS: Record<"CV1" | "CV3" | "CVT", { air: string; duct: string; buried: string; amps: Record<string, Row> }> = {
  // 単心: 3条を俵積み（気中）、管路は4孔3条（1孔に1条ずつ）、直埋は平積（S=d）
  CV1: {
    air: "3条 俵積み",
    duct: "4孔3条",
    buried: "3条 平積",
    amps: table([[50, null, 66], [63, null, 81], [87, null, 110], [115, null, 140], [160, null, 190], [210, null, 245], [290, 310, 325], [380, 390, 405], [470, 460, 470], [540, 520, 525], [640, 600, 605]]),
  },
  CV3: {
    air: "1条",
    duct: "2孔1条",
    buried: "1条",
    amps: table([[44, 43, 58], [54, 53, 71], [76, 74, 97], [100, 97, 125], [140, 130, 170], [190, 170, 215], [260, 230, 285], [340, 295, 360], [410, 350, 420], [470, 395, 470], [555, 455, 540]]),
  },
  CVT: {
    air: "1条",
    duct: "2孔1条",
    buried: "1条",
    amps: table([null, [62, 59, 77], [86, 81, 100], [110, 105, 130], [155, 145, 180], [210, 185, 230], [290, 250, 305], [380, 320, 380], [465, 380, 445], [535, 430, 500], [635, 500, 570]]),
  },
};
// 周囲温度の補正係数（同じ資料）。表にない温度は、その上の温度の係数を使う（安全側）
const TEMP_AIR: [number, number][] = [[20, 1.18], [25, 1.14], [30, 1.1], [35, 1.05], [40, 1], [45, 0.95], [50, 0.89]];
const TEMP_GROUND: [number, number][] = [[20, 1.04], [25, 1], [30, 0.96], [35, 0.92], [40, 0.88], [45, 0.83], [50, 0.78]];

// IV: 146-1表（単線、直径mm）・146-2表（より線、mm²）の軟銅線の値
const SOLID: [number, number, number][] = [
  [1.0, 1.2, 16], [1.2, 1.6, 19], [1.6, 2.0, 27], [2.0, 2.6, 35], [2.6, 3.2, 48], [3.2, 4.0, 62], [4.0, 5.0, 81], [5.0, 5.0001, 107],
];
const STRANDED: [number, number, number][] = [
  [0.9, 1.25, 17], [1.25, 2, 19], [2, 3.5, 27], [3.5, 5.5, 37], [5.5, 8, 49], [8, 14, 61], [14, 22, 88], [22, 30, 115], [30, 38, 139],
  [38, 50, 162], [50, 60, 190], [60, 80, 217], [80, 100, 257], [100, 125, 298], [125, 150, 344], [150, 200, 395], [200, 250, 469], [250, 325, 556], [325, 400, 650],
];
/** 146-1表・146-2表 (soft copper) before any correction: the measure of "同等以上の許容電流" in 149-1表. */
export function ivBaseAmps(s: string): number | null {
  const solid = ["1.6", "2.0", "2.6"].includes(s);
  const row = (solid ? SOLID : STRANDED).find(([lo, hi]) => Number(s) >= lo && Number(s) < hi);
  return row ? row[2] : null;
}

const IV_T = 60; // 146-3表: ビニル混合物（耐熱性を有するものを除く）
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

export type WireType = "IV" | "CV1" | "CV3" | "CVT";
const TYPES: Record<WireType, { label: string; sizes: string[] }> = {
  IV: { label: "IV（600Vビニル絶縁電線）", sizes: ["1.6", "2.0", "2.6", ...SIZES] },
  CV1: { label: "CV 単心", sizes: SIZES },
  CV3: { label: "CV 3心", sizes: SIZES },
  CVT: { label: "CVT", sizes: SIZES.slice(1) },
};
const isSolid = (t: WireType, s: string) => t === "IV" && ["1.6", "2.0", "2.6"].includes(s);
const sizeLabel = (t: WireType, s: string) => (isSolid(t, s) ? `${s}mm` : `${s}sq`);
const wireName = (t: WireType, s: string) => `${t === "CV1" ? "CV" : t === "CV3" ? "CV-3C" : t} ${sizeLabel(t, s)}`;
const area = (t: WireType, s: string) => (isSolid(t, s) ? (Math.PI * Number(s) ** 2) / 4 : Number(s));

export interface Conditions {
  install: Install; // CV・CVT
  ambient: number | null; // ℃、null なら資料の基準温度
  inConduit: number; // IV: 同じ管の電線数（0 = 管に入れない）
}

/** Allowable current of one wire, with how it was found. Throws when the table has no value. */
export function ampsOf(t: WireType, s: string, c: Conditions): { amps: number; steps: string[]; basis: Basis[]; source: string } {
  if (t === "IV") {
    const theta = Math.max(30, c.ambient ?? 30);
    if (theta >= IV_T) throw new CalcInputError("周囲温度が IV の上限（60℃）以上です");
    const solid = isSolid(t, s);
    const row = (solid ? SOLID : STRANDED).find(([lo, hi]) => Number(s) >= lo && Number(s) < hi);
    if (!row) throw new CalcInputError("この太さは表の範囲外です");
    const k = Math.sqrt((IV_T - theta) / 30);
    const r = c.inConduit > 0 ? reductionFactor(c.inConduit) : 1;
    const amps = row[2] * k * r;
    return {
      amps,
      source: `電技解釈 第146条${c.inConduit > 0 ? `・同一管内${c.inConduit}本` : "・管に入れない"}・周囲${theta}℃`,
      steps: [
        `${solid ? "146-1表（単線）" : "146-2表（より線）"}: ${row[2]}A`,
        `補正係数（146-3表・ビニル）: √((60 − ${theta}) ÷ 30) = ${fmt(k, 3)}`,
        c.inConduit > 0 ? `電流減少係数（146-4表・同一管内${c.inConduit}本）: ${r}` : "管に入れない → 電流減少係数なし",
        `${wireName(t, s)} の許容電流 = ${row[2]} × ${fmt(k, 3)}${c.inConduit > 0 ? ` × ${r}` : ""} = ${fmt(amps, 1)}A`,
      ],
      basis: [
        { lawId: "kaishaku-146", quote: "単線にあっては146-1表に、成形単線又はより線にあっては146-2表にそれぞれ規定する許容電流に、第二号に規定する係数を乗じた値であること。" },
        ...(c.inConduit > 0 ? [{ lawId: "kaishaku-146", quote: "146-4表に規定する電流減少係数を乗じた値であること。" }] : []),
      ],
    };
  }
  const tb = CABLE_AMPS[t];
  const base = tb.amps[s]?.[c.install === "air" ? 0 : c.install === "duct" ? 1 : 2];
  if (base == null) throw new CalcInputError(`${wireName(t, s)} の${INSTALL[c.install].label}の値は、メーカーの表にありません`);
  const ref = INSTALL[c.install].base;
  const theta = c.ambient ?? ref;
  const temps = c.install === "air" ? TEMP_AIR : TEMP_GROUND;
  const row = theta <= temps[0][0] ? temps[0] : temps.find(([deg]) => deg >= theta);
  if (!row) throw new CalcInputError("周囲温度が表の範囲（50℃まで）を超えています");
  const amps = base * row[1];
  const how = tb[c.install];
  const place = INSTALL[c.install].label.replace(/（.*）/, "");
  return {
    amps,
    source: `メーカー表（JCS 0168-2）・${place} ${how}・${c.install === "air" ? "周囲" : "基底"}${theta}℃`,
    steps: [
      `${wireName(t, s)}・${place} ${how}: ${base}A（メーカー表、${ref}℃）`,
      ...(row[1] !== 1 ? [`温度の補正係数（${row[0]}℃の値）: ${row[1]} → ${fmt(amps, 1)}A`] : []),
    ],
    basis: [],
  };
}

// ---------- 入力欄（電線まわりは3つの計算で共通） ----------
const wf = {
  wireType: { key: "wireType", label: "電線の種類", type: "select", default: "CVT", options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label, short: t.label.replace(/（.*）/, "") })) },
  size: {
    key: "size",
    label: "太さ",
    type: "select",
    default: "38",
    options: [...new Set(Object.values(TYPES).flatMap((t) => t.sizes))].map((s) => ({ value: s, label: s })),
    optionsBy: { key: "wireType", map: Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.sizes.map((s) => ({ value: s, label: sizeLabel(k as WireType, s) }))])) },
  },
  parallel: { key: "parallel", label: "並列の本数（ダブル＝2）", type: "select", default: "1", options: [{ value: "1", label: "1（並列なし）" }, { value: "2", label: "2（ダブル）" }, { value: "3", label: "3（トリプル）" }] },
  install: { key: "install", label: "布設のしかた", type: "select", default: "air", options: Object.entries(INSTALL).map(([value, s]) => ({ value, label: s.label })), showIf: { key: "wireType", values: ["CV1", "CV3", "CVT"] } },
  inConduit: { key: "inConduit", label: "同じ管に入れる電線の本数（管に入れないなら0）", type: "number", unit: "本", default: 3, min: 0, max: 200, showIf: { key: "wireType", values: ["IV"] } },
  ambient: { key: "ambient", label: "周囲温度（空欄なら IV 30℃・気中40℃・地中25℃）", type: "number", unit: "℃", min: -20, max: 59 },
} satisfies Record<string, Field>;

const given = (p: Record<string, unknown>, k: string) => p[k] !== undefined && p[k] !== null && p[k] !== "";

function readWire(p: Record<string, unknown>, needSize = true) {
  const t = pick<WireType>(p, wf.wireType);
  // Claude's tool schema sends the size as a number, and JSON turns 2.0 into 2: match "2" to "2.0" by value
  const raw = p.size ?? wf.size.default;
  const s = typeof raw === "number" ? (TYPES[t].sizes.find((x) => Number(x) === raw) ?? String(raw)) : String(raw);
  if (needSize && !TYPES[t].sizes.includes(s)) throw new CalcInputError(`${TYPES[t].label}に ${s} はありません（${TYPES[t].sizes.join("・")}）`);
  const n = Number(pick(p, wf.parallel));
  const c: Conditions = {
    install: t === "IV" ? "air" : pick<Install>(p, wf.install),
    ambient: given(p, "ambient") ? num(p, wf.ambient) : null,
    inConduit: t === "IV" ? Math.round(num(p, wf.inConduit)) : 0,
  };
  return { t, s, n, c };
}
const parallelNote = "並列にする電線は、同じ種類・同じ太さ・同じ長さにしてください。並列のケーブルを近づけて並べると許容電流が下がるので、メーカーの低減率も確認してください。";
const label = (t: WireType, s: string, n: number) => `${wireName(t, s)}${n > 1 ? ` ×${n}並列` : ""}`;

/** The thinnest size of this type that carries the current (and keeps the drop within the limit, if given). */
export function thinnest(t: WireType, n: number, c: Conditions, current: number, drop?: { k: number; L: number; V: number; limit: number }) {
  for (const s of TYPES[t].sizes) {
    let a: number;
    try {
      a = ampsOf(t, s, c).amps * n;
    } catch {
      continue;
    }
    if (a < current) continue;
    if (drop && ((drop.k * drop.L * current) / (1000 * area(t, s) * n) / drop.V) * 100 > drop.limit) continue;
    return { s, amps: a };
  }
  return null;
}

// こう長に応じた電圧降下の目安（内線規程の考え方。本文は載せない）
export function dropLimit(L: number) {
  return L <= 60 ? 2 : L <= 120 ? 4 : L <= 200 ? 5 : 6;
}

// ---------- 電圧降下（銅線の簡略式） ----------
const SYSTEMS = {
  single2: { label: "単相2線式", k: 35.6, v: 100, note: "線間の電圧降下" },
  single3: { label: "単相3線式（外線と中性線の間）", k: 17.8, v: 100, note: "外線と中性線の間の電圧降下（平衡負荷）" },
  three3: { label: "三相3線式", k: 30.8, v: 200, note: "線間の電圧降下" },
} as const;
const vd = {
  system: { key: "system", label: "配電方式", type: "select", default: "three3", options: Object.entries(SYSTEMS).map(([value, s]) => ({ value, label: s.label })) },
  length: { key: "length", label: "こう長（片道）", type: "number", unit: "m", min: 0.1, max: 2000 },
  current: { key: "current", label: "負荷電流", type: "number", unit: "A", min: 0.1, max: 5000 },
  ...wf,
  voltage: { key: "voltage", label: "基準の電圧（%の計算に使う）", type: "number", unit: "V", min: 1, help: "空欄なら単相100V・三相200V" },
} satisfies Record<string, Field>;

export const voltageDrop: Calc = {
  name: "voltage_drop",
  label: "電圧降下と電線の太さ",
  description:
    "銅線の電圧降下を簡略式（e = K×L×I ÷ (1000×A)、K=35.6/17.8/30.8）で計算し、%を出す。あわせて、負荷電流に対して許容電流が足りるか、電圧降下がこう長の目安（60m以下2%・120m以下4%・200m以下5%・超6%）以内かを判定し、だめなら両方を満たす一番細い太さを出す。並列（CVT100をダブル等）は parallel で。",
  fields: Object.values(vd),
  run(p) {
    const sys = SYSTEMS[pick<keyof typeof SYSTEMS>(p, vd.system)];
    const L = num(p, vd.length);
    const I = num(p, vd.current);
    const { t, s, n, c } = readWire(p);
    const V = given(p, "voltage") ? num(p, vd.voltage) : sys.v;
    const A = area(t, s) * n;
    const e = (sys.k * L * I) / (1000 * A);
    const pct = (e / V) * 100;
    const limit = dropLimit(L);
    const amp = ampsOf(t, s, c);
    const allowed = amp.amps * n;
    const ampOk = I <= allowed;
    const dropOk = pct <= limit;
    const ok = ampOk && dropOk;
    const better = ok ? null : thinnest(t, n, c, I, { k: sys.k, L, V, limit });
    const steps = [
      `式: e = ${sys.k} × L × I ÷ (1000 × A)`,
      `電線 ${label(t, s, n)} → 断面積 A = ${fmt(area(t, s))}${n > 1 ? ` × ${n}` : ""} = ${fmt(A)}mm²`,
      `e = ${sys.k} × ${fmt(L)} × ${fmt(I)} ÷ (1000 × ${fmt(A)}) = ${fmt(e)}V`,
      `${V}V に対して ${fmtVs(pct, limit, 1)[0]}%（${sys.note}）`,
      `電圧降下の目安: こう長 ${fmt(L)}m → ${limit}%以内 … ${dropOk ? "○" : "×"}`,
      ...amp.steps,
      `許容電流 ${fmtVs(allowed, I, 1)[0]}A${n > 1 ? `（${fmt(amp.amps, 1)}A × ${n}並列）` : ""} ${ampOk ? "≧" : "＜"} 負荷 ${fmtVs(allowed, I, 1)[1]}A … ${ampOk ? "○" : "×"}`,
    ];
    if (!ok)
      steps.push(
        better
          ? `両方を満たす一番細い ${TYPES[t].label}: ${label(t, better.s, n)}（許容 ${fmt(better.amps, 1)}A）`
          : `${TYPES[t].label}${n > 1 ? `の${n}並列` : ""}では325sqでも足りません。並列の本数を増やしてください`,
      );
    const why = [!ampOk && "許容電流が足りません", !dropOk && `電圧降下が目安${limit}%を超えます`].filter(Boolean).join("・");
    return {
      title: `電圧降下と太さの判定（${sys.label}・${label(t, s, n)}）`,
      ok,
      verdict: `${fmt(e)}V（${fmtVs(pct, limit, 1)[0]}%）／${ok ? "この太さで適正" : `${why}${better ? ` → ${label(t, better.s, n)} 以上` : ""}`}`,
      steps,
      basis: amp.basis,
      notes: [
        "銅線の簡略式です（力率・リアクタンスは考えていません）。",
        "電圧降下の目安は内線規程の考え方です（本文は載せていません）。こう長60m以下は幹線・分岐回路それぞれ2%、60mを超えると幹線と分岐回路の合計で4%・5%・6%（電力会社から低圧で受電する場合。構内に変圧器がある場合は少し緩い値）。設計図書・電力会社の指定があればそちらに従ってください。",
        `許容電流は ${amp.source} の条件です。`,
        ...(n > 1 ? [parallelNote] : []),
      ],
    };
  },
};

// ---------- 電線の許容電流 ----------
const amp = {
  ...wf,
  load: { key: "load", label: "流す電流（空欄なら許容電流だけ）", type: "number", unit: "A", min: 0 },
} satisfies Record<string, Field>;

export const ampacity: Calc = {
  name: "wire_ampacity",
  label: "電線の許容電流",
  description:
    "IV（電技解釈第146条で計算）・CV単心・CV3心・CVT（メーカー表 JCS 0168-2、気中/管路/直埋）の許容電流を、種類と太さで出し、流す電流が収まるか判定する。並列（ダブル）にも対応。",
  fields: Object.values(amp),
  run(p) {
    const { t, s, n, c } = readWire(p);
    const a = ampsOf(t, s, c);
    const allowed = a.amps * n;
    const load = given(p, "load") ? num(p, amp.load) : null;
    const ok = load === null ? null : load <= allowed;
    return {
      title: `電線の許容電流（${label(t, s, n)}）`,
      ok,
      verdict:
        load === null
          ? `${label(t, s, n)}：許容電流 ${fmt(allowed, 1)}A`
          : `${ok ? "OK" : "NG"}（流す ${fmtVs(load, allowed, 1)[0]}A ${ok ? "≦" : "＞"} ${label(t, s, n)} の許容 ${fmtVs(load, allowed, 1)[1]}A）`,
      steps: [...a.steps, ...(n > 1 ? [`${n}並列: ${fmt(a.amps, 1)} × ${n} = ${fmt(allowed, 1)}A`] : [])],
      basis: a.basis,
      notes: [`条件: ${a.source}`, "許容電流は小数点以下を切り捨てて使うのが一般的です。", ...(n > 1 ? [parallelNote] : [])],
    };
  },
};

// ---------- kW から電線の太さ ----------
const PHASES = {
  single: { label: "単相2線式", k: 35.6, root3: false, formula: "I = P ÷ (V × cosθ)" },
  single3: { label: "単相3線式（100/200V）", k: 17.8, root3: false, formula: "I = P ÷ (200 × cosθ)（平衡負荷）" },
  three: { label: "三相3線式", k: 30.8, root3: true, formula: "I = P ÷ (√3 × V × cosθ)" },
} as const;
const lw = {
  kw: { key: "kw", label: "負荷の容量", type: "number", unit: "kW", min: 0.01, max: 5000 },
  phase: { key: "phase", label: "配電方式", type: "select", default: "three", options: Object.entries(PHASES).map(([value, s]) => ({ value, label: s.label })) },
  voltage: { key: "voltage", label: "電圧", type: "number", unit: "V", default: 200, min: 50, max: 600, help: "単相3線式は 200 のまま" },
  pf: { key: "pf", label: "力率 cosθ", type: "number", default: 0.8, min: 0.1, max: 1 },
  motor: { key: "motor", label: "電動機（モーター）の幹線として選ぶ（1.25倍・1.1倍）", type: "boolean", default: false },
  wireType: wf.wireType,
  parallel: wf.parallel,
  install: wf.install,
  inConduit: wf.inConduit,
  ambient: wf.ambient,
  length: { key: "length", label: "こう長（入れると電圧降下も確かめる）", type: "number", unit: "m", min: 0.1, max: 2000 },
} satisfies Record<string, Field>;

export const loadToWire: Calc = {
  name: "wire_for_load",
  label: "kWから電線の太さ",
  description:
    "負荷の容量（kW）・電圧・力率から電流を出し、許容電流が足りる一番細い太さを、IV・CV単心・CV3心・CVT のそれぞれで出す（選んだ種類を結論にする）。電動機の幹線なら1.25倍/1.1倍（電技解釈第148条）。こう長を入れると電圧降下の目安も満たす太さにする。並列（ダブル）にも対応。",
  fields: Object.values(lw),
  run(p) {
    const ph = PHASES[pick<keyof typeof PHASES>(p, lw.phase)];
    const P = num(p, lw.kw) * 1000;
    const V = ph === PHASES.single3 ? 200 : num(p, lw.voltage);
    const pf = num(p, lw.pf);
    const I0 = P / ((ph.root3 ? Math.sqrt(3) : 1) * V * pf);
    const motor = flag(p, lw.motor);
    const factor = motor ? (I0 <= 50 ? 1.25 : 1.1) : 1;
    const I = I0 * factor;
    const { t, n, c } = readWire(p, false);
    const L = given(p, "length") ? num(p, lw.length) : null;
    const drop = L === null ? undefined : { k: ph.k, L, V: ph === PHASES.single3 ? 100 : V, limit: dropLimit(L) };
    const steps = [`${ph.formula} = ${fmt(P)} ÷ (${ph.root3 ? "√3 × " : ""}${V} × ${pf}) = ${fmt(I0, 1)}A`];
    if (motor) steps.push(`電動機の幹線: ${fmtVs(I0, 50, 1)[0]}A ${I0 <= 50 ? "≦" : "＞"} 50A → × ${factor} = ${fmt(I, 1)}A 以上の許容電流が要る`);
    if (drop) steps.push(`電圧降下の目安: こう長 ${fmt(L!)}m → ${drop.limit}%以内も満たす太さを探す（電流 ${fmt(I0, 1)}A で計算）`);
    const results = (Object.keys(TYPES) as WireType[]).map((tt) => {
      const cc: Conditions = { ...c, install: tt === "IV" ? "air" : c.install, inConduit: tt === "IV" ? (t === "IV" ? c.inConduit : 3) : 0 };
      // the drop uses the load current itself, not the motor allowance
      let r = thinnest(tt, n, cc, I);
      if (r && drop) {
        const i = TYPES[tt].sizes.indexOf(r.s);
        const ok = TYPES[tt].sizes.slice(i).find((s) => ((drop.k * drop.L * I0) / (1000 * area(tt, s) * n) / drop.V) * 100 <= drop.limit);
        r = ok ? { s: ok, amps: ampsOf(tt, ok, cc).amps * n } : null;
      }
      return { tt, r };
    });
    for (const { tt, r } of results) steps.push(`${TYPES[tt].label}${n > 1 ? `（${n}並列）` : ""}: ${r ? `${label(tt, r.s, n)}（許容 ${fmt(r.amps, 1)}A）` : "325sqでも足りない"}`);
    const mine = results.find((x) => x.tt === t)!.r;
    const a = mine ? ampsOf(t, mine.s, c) : null;
    return {
      title: `${fmt(P / 1000)}kW の電線の太さ（${ph.label}）`,
      ok: !!mine,
      verdict: mine
        ? `電流 ${fmt(I0, 1)}A → ${label(t, mine.s, n)} 以上（許容 ${fmt(mine.amps, 1)}A）`
        : `電流 ${fmt(I0, 1)}A → ${TYPES[t].label}${n > 1 ? `の${n}並列` : ""}では325sqでも足りません`,
      steps,
      basis: [
        ...(a?.basis ?? []),
        ...(motor ? [{ lawId: "kaishaku-148", quote: I0 <= 50 ? "電動機等の定格電流の合計が50A以下の場合は、その定格電流の合計の1.25倍" : "電動機等の定格電流の合計が50Aを超える場合は、その定格電流の合計の1.1倍" }] : []),
      ],
      notes: [
        `${TYPES[t].label}の条件: ${a?.source ?? "—"}。ほかの種類の IV は同じ管に3本で計算しています。`,
        ...(motor ? ["電動機以外の負荷もつながる幹線は、その定格電流の合計を足してください。始動電流・保護装置との協調も確認してください。"] : []),
        ...(n > 1 ? [parallelNote] : []),
      ],
    };
  },
};

// ---------- 分岐回路の電線の太さ（電技解釈 第149条 149-1表） ----------
// The size a branch circuit needs is set by its breaker (149-1表), not by the ampacity in a conduit:
// 146-4表's reduction factor does not apply here (第146条第2項第二号ロ ただし書).
const BRANCH: { max: number; mccbOnly?: boolean; size: string; label: string }[] = [
  { max: 15, size: "1.6", label: "定格電流が15A以下" },
  { max: 20, mccbOnly: true, size: "1.6", label: "15Aを超え20A以下の配線用遮断器" },
  { max: 20, size: "2.0", label: "15Aを超え20A以下（配線用遮断器を除く）" },
  { max: 30, size: "2.6", label: "20Aを超え30A以下" },
  { max: 40, size: "8", label: "30Aを超え40A以下" },
  { max: 50, size: "14", label: "40Aを超え50A以下" },
];
const BRANCH_SIZES = ["1.6", "2.0", "2.6", "5.5", "8", "14", "22"];
const br = {
  amps: { key: "amps", label: "分岐回路のブレーカー（過電流遮断器）の定格電流", type: "number", unit: "A", default: 20, min: 1, max: 50 },
  breakerKind: { key: "breakerKind", label: "ブレーカーの種類", type: "select", default: "mccb", options: [{ value: "mccb", label: "配線用遮断器" }, { value: "other", label: "ヒューズなど（配線用遮断器以外）" }] },
  size: { key: "size", label: "使う電線の太さ（軟銅線）", type: "select", emptyLabel: "選ばない", options: BRANCH_SIZES.map((s) => ({ value: s, label: sizeLabel("IV", s) })) },
} satisfies Record<string, Field>;

export const branchWire: Calc = {
  name: "branch_wire",
  label: "分岐回路の電線の太さ（ブレーカーから）",
  description:
    "低圧の分岐回路のブレーカーの定格電流（50A以下）から、電技解釈第149条の149-1表で必要な電線（軟銅線）の太さを出し、使う電線が足りるか判定する（同等以上の許容電流かは146-1表・146-2表の値で比べる）。配線用遮断器20Aなら1.6mm。電動機だけの回路は対象外。",
  fields: Object.values(br),
  run(p) {
    const A = num(p, br.amps);
    const kind = pick<"mccb" | "other">(p, br.breakerKind);
    const row = BRANCH.find((r) => A <= r.max && (!r.mccbOnly || kind === "mccb"))!;
    const need = ivBaseAmps(row.size)!;
    const given = p.size === undefined || p.size === null || p.size === "" ? null : pick<string>(p, br.size);
    const have = given === null ? null : ivBaseAmps(given)!;
    const ok = have === null ? null : have >= need;
    const needName = sizeLabel("IV", row.size);
    return {
      title: `分岐回路の電線の太さ（${A}A・${kind === "mccb" ? "配線用遮断器" : "配線用遮断器以外"}）`,
      ok,
      verdict:
        given === null
          ? `${needName} 以上（149-1表）`
          : `${ok ? "OK" : "NG"}（${sizeLabel("IV", given)} ${ok ? "≧" : "＜"} 必要 ${needName}）`,
      steps: [
        `149-1表: ${row.label} → 軟銅線 ${needName}`,
        `${needName} の許容電流（146表の値）: ${need}A`,
        ...(given === null ? [] : [`${sizeLabel("IV", given)} の許容電流（146表の値）: ${have}A → ${ok ? "同等以上" : "足りない"}`]),
        "この表で選ぶ時は、管に入れる本数による電流減少係数（146-4表）は掛けません。",
      ],
      basis: [
        { lawId: "kaishaku-149", quote: "イ 第1項第一号の規定により施設する過電流遮断器の定格電流は、50A以下であること。" },
        { lawId: "kaishaku-149", quote: "太さが149-1表の中欄に規定する値の軟銅線若しくはこれと同等以上の許容電流のあるもの" },
        { lawId: "kaishaku-146", quote: "ただし、第148条第1項第五号ただし書並びに第149条第2項第一号ロ及び第二号イに規定する場合においては、この限りでない。" },
      ],
      notes: [
        "電動機だけにつながる分岐回路は、第149条第2項第二号（電線の許容電流は電動機の定格電流の1.25倍・1.1倍以上）で選びます。",
        "コンセントの定格もブレーカーに合わせて決まります（149-3表）。長い配線は電圧降下も確かめてください。",
      ],
    };
  },
};
