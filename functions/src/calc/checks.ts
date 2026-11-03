import { Calc, CalcInputError, CalcResult, Field, flag, fmt, num, pick } from "./types";

// ---------- 絶縁抵抗（電技省令 第58条） ----------
const ins = {
  voltage: { key: "voltage", label: "使用電圧の区分", type: "select", default: "le150", options: [
    { value: "le150", label: "300V以下・対地150V以下（単相100V、単相3線100/200V など）" },
    { value: "other300", label: "300V以下・その他（三相200V など）" },
    { value: "over300", label: "300Vを超える（400V級 など）" },
  ] },
  measured: { key: "measured", label: "測定値", type: "number", unit: "MΩ", min: 0 },
} satisfies Record<string, Field>;
const INS_LIMIT = {
  le150: { mohm: 0.1, quote: "百五十ボルト以下の場合｜〇・一メガオーム" },
  other300: { mohm: 0.2, quote: "その他の場合｜〇・二メガオーム" },
  over300: { mohm: 0.4, quote: "三百ボルトを超えるもの｜〇・四メガオーム" },
};

export const insulation: Calc = {
  name: "insulation_check",
  label: "絶縁抵抗の合否",
  description: "低圧電路の絶縁抵抗の測定値（MΩ）が電技省令第58条の値以上かを判定する。",
  fields: Object.values(ins),
  run(p) {
    const v = pick<keyof typeof INS_LIMIT>(p, ins.voltage);
    const m = num(p, ins.measured);
    const lim = INS_LIMIT[v];
    const ok = m >= lim.mohm;
    return {
      title: "絶縁抵抗の合否",
      ok,
      verdict: `${ok ? "合格" : "不合格"}（測定 ${fmt(m, 3)}MΩ ${ok ? "≧" : "＜"} 基準 ${lim.mohm}MΩ）`,
      steps: [`区分: ${ins.voltage.options!.find((o) => o.value === v)!.label}`, `基準値: ${lim.mohm}MΩ以上`, `測定値: ${fmt(m, 3)}MΩ`],
      basis: [
        { lawId: "409M50000400052-58", quote: "開閉器又は過電流遮断器で区切ることのできる電路ごとに" },
        { lawId: "409M50000400052-58", quote: lim.quote },
      ],
      notes: ["電線相互間と、電路と大地との間の両方で基準を満たす必要があります。"],
    };
  },
};

// ---------- 接地抵抗（電技解釈 第17条） ----------
const gnd = {
  type: { key: "type", label: "接地工事の種類", type: "select", default: "D", options: [
    { value: "A", label: "A種" },
    { value: "B", label: "B種（変圧器の低圧側の中性点など）" },
    { value: "C", label: "C種（300V超の低圧の機器）" },
    { value: "D", label: "D種（300V以下の低圧の機器）" },
  ] },
  fastBreaker: { key: "fastBreaker", label: "地絡時に0.5秒以内に自動遮断する装置（漏電遮断器など）がある", type: "boolean", default: false, showIf: { key: "type", values: ["C", "D"] } },
  // B種: 17-1表の値 = 150/300/600 ÷ Ig。Ig は実測（電力会社に聞いた値）か 17-2表の式
  cutoff: { key: "cutoff", label: "混触時に高圧側を自動で遮断する時間", type: "select", default: "none", showIf: { key: "type", values: ["B"] }, options: [
    { value: "none", label: "遮断装置なし（または2秒を超える）" },
    { value: "1to2", label: "1秒を超え2秒以下" },
    { value: "le1", label: "1秒以下" },
  ] },
  ig: { key: "ig", label: "1線地絡電流 Ig（電力会社に聞いた値。空欄なら下の式で計算）", type: "number", unit: "A", min: 0.1, max: 1000, showIf: { key: "type", values: ["B"] } },
  // 17-2表 is for 高圧 circuits (≤7,000V); 特別高圧 uses measured or line-constant values (第17条第2項第二号ハ)
  kv: { key: "kv", label: "高圧電路の公称電圧（特別高圧は Ig を入れてください）", type: "number", unit: "kV", default: 6.6, min: 1, max: 7, showIf: { key: "type", values: ["B"] } },
  overhead: { key: "overhead", label: "同じ母線の架空電線（ケーブル以外）の電線延長", type: "number", unit: "km", default: 0, min: 0, max: 10000, help: "線路の長さ×電線の本数（3線なら3倍）", showIf: { key: "type", values: ["B"] } },
  cableLen: { key: "cableLen", label: "同じ母線のケーブルの線路延長", type: "number", unit: "km", default: 0, min: 0, max: 10000, showIf: { key: "type", values: ["B"] } },
  measured: { key: "measured", label: "測定値（B種は空欄なら基準値だけ）", type: "number", unit: "Ω", min: 0 },
} satisfies Record<string, Field>;

export const grounding: Calc = {
  name: "grounding_check",
  label: "接地抵抗の合否",
  description: "A種・B種・C種・D種接地工事の接地抵抗の測定値（Ω）が電技解釈第17条の値以下かを判定する。B種は 17-1表（150/300/600 ÷ 1線地絡電流Ig）で基準値を出す。Igは実測値か、17-2表の式（公称電圧・架空電線延長・ケーブル線路延長）で計算する。",
  fields: Object.values(gnd),
  run(p) {
    const t = pick<"A" | "B" | "C" | "D">(p, gnd.type);
    if (t === "B") return groundingB(p);
    const fast = flag(p, gnd.fastBreaker);
    const m = num(p, gnd.measured);
    const lim = t === "A" ? 10 : fast ? 500 : t === "C" ? 10 : 100;
    const ok = m <= lim;
    const basis =
      t === "A"
        ? [{ lawId: "kaishaku-17", quote: "第17条 A種接地工事は、次の各号によること。" }, { lawId: "kaishaku-17", quote: "一 接地抵抗値は、10Ω以下であること。" }]
        : t === "C"
          ? [{ lawId: "kaishaku-17", quote: "接地抵抗値は、10Ω（低圧電路において、地絡を生じた場合に0.5秒以内に当該電路を自動的に遮断する装置を施設するときは、500Ω）以下であること。" }]
          : [{ lawId: "kaishaku-17", quote: "接地抵抗値は、100Ω（低圧電路において、地絡を生じた場合に0.5秒以内に当該電路を自動的に遮断する装置を施設するときは、500Ω）以下であること。" }];
    return {
      title: `${t}種接地工事の接地抵抗`,
      ok,
      verdict: `${ok ? "合格" : "不合格"}（測定 ${fmt(m)}Ω ${ok ? "≦" : "＞"} 基準 ${lim}Ω）`,
      steps: [`${t}種接地工事`, t === "A" ? "基準値: 10Ω以下" : `0.5秒以内の自動遮断装置: ${fast ? "あり → 500Ω以下" : `なし → ${lim}Ω以下`}`, `測定値: ${fmt(m)}Ω`],
      basis,
      notes: [],
    };
  },
};

const has = (p: Record<string, unknown>, k: string) => p[k] !== undefined && p[k] !== null && p[k] !== "";

function groundingB(p: Record<string, unknown>): CalcResult {
  const cut = pick<"none" | "1to2" | "le1">(p, gnd.cutoff);
  const numer = { none: 150, "1to2": 300, le1: 600 }[cut];
  const steps: string[] = [];
  let ig: number;
  if (has(p, "ig")) {
    ig = num(p, gnd.ig);
    steps.push(`1線地絡電流 Ig = ${fmt(ig)}A（入力値）`);
  } else {
    // 17-2表 中性点非接地式電路: I1 = 1 + (V'/3·L − 100)/150 + (V'/3·L' − 1)/2、第2項・第3項は負なら0
    const v = num(p, gnd.kv) / 1.1;
    const L = num(p, gnd.overhead);
    const Lc = num(p, gnd.cableLen);
    if (L === 0 && Lc === 0) throw new CalcInputError("Ig を入れるか、架空電線延長・ケーブル線路延長を入れてください");
    const t2 = Math.max(0, ((v / 3) * L - 100) / 150);
    const t3 = Math.max(0, ((v / 3) * Lc - 1) / 2);
    const raw = 1 + t2 + t3;
    ig = Math.max(2, Math.ceil(raw));
    steps.push(
      `V' = ${fmt(num(p, gnd.kv), 1)}kV ÷ 1.1 = ${fmt(v, 3)}kV`,
      `I1 = 1 ＋ (${fmt(v, 3)}/3 × ${fmt(L)} − 100) ÷ 150 ＋ (${fmt(v, 3)}/3 × ${fmt(Lc)} − 1) ÷ 2`,
      `　= 1 ＋ ${fmt(t2, 3)} ＋ ${fmt(t3, 3)} = ${fmt(raw, 3)}（負の項は0）`,
      `小数点以下を切り上げ（2A未満は2A）→ Ig = ${ig}A`,
    );
  }
  const lim = numer / ig;
  steps.push(`基準値 = ${numer} ÷ ${fmt(ig)} = ${fmt(lim, 1)}Ω`);
  const hasM = has(p, "measured");
  const m = hasM ? num(p, gnd.measured) : null;
  const ok = m === null ? null : m <= lim;
  if (m !== null) steps.push(`測定値: ${fmt(m)}Ω`);
  return {
    title: "B種接地工事の接地抵抗",
    ok,
    verdict: m === null ? `基準値 ${fmt(lim, 1)}Ω以下（${numer}／Ig、Ig = ${fmt(ig)}A）` : `${ok ? "合格" : "不合格"}（測定 ${fmt(m)}Ω ${ok ? "≦" : "＞"} 基準 ${fmt(lim, 1)}Ω）`,
    steps,
    basis: [
      { lawId: "kaishaku-17", quote: "2 B種接地工事は、次の各号によること。" },
      { lawId: "kaishaku-17", quote: "一 接地抵抗値は、17-1表に規定する値以下であること。" },
      ...(has(p, "ig") ? [] : [{ lawId: "kaishaku-17", quote: "計算結果は、小数点以下を切り上げ、2A未満となる場合は2Aとする。" }]),
    ],
    notes: [
      "1線地絡電流は、受電する電力会社に問い合わせた値を使うのが確実です。式は中性点非接地式の高圧電路の場合です。",
      "B種の基準値が5Ω未満になるなど施工が難しい場合の扱い（混触防止板など）は、条文の全文を確認してください。",
    ],
  };
}

// ---------- 配管・ケーブルの支持間隔（標準仕様書 / 電技解釈） ----------
const SUPPORT = {
  metal: { label: "金属管（隠ぺい・露出）", limit: 2, basis: [{ lawId: "shiyo-2.2.3", quote: "管の支持は、サドル、ハンガ等を使用し、その取付け間隔は 2ｍ以下とする。" }] },
  pf_hidden: { label: "PF管・CD管（隠ぺい）", limit: 1.5, basis: [{ lawId: "shiyo-2.3.3", quote: "その取付け間隔は1.5ｍ以下とする。" }, { lawId: "kaishaku-158", quote: "支持点間の距離は1.5m以下とし" }] },
  // CD管 cannot be run exposed (解釈 第158条第3項第七号), so the exposed row is PF only
  pf_exposed: { label: "PF管（露出）", limit: 1, basis: [{ lawId: "shiyo-2.3.4", quote: "管の支持は、サドル、クリップ、ハンガ等を使用し、その取付け間隔は 1ｍ以下とする。" }, { lawId: "kaishaku-158", quote: "CD管は、次のいずれかにより施設すること。" }] },
  vinyl: { label: "硬質ビニル管（VE管）", limit: 1.5, basis: [{ lawId: "shiyo-2.4.3", quote: "管の支持は、サドル、ハンガ等を使用し、その取付け間隔は、1.5ｍ以下とする。" }, { lawId: "kaishaku-158", quote: "支持点間の距離は1.5m以下とし" }] },
  flexible: { label: "金属製可とう電線管", limit: 1, basis: [{ lawId: "shiyo-2.5.3", quote: "取付け間隔は、1ｍ以下とする。" }] },
  cable: { label: "ケーブル（造営材の下面・側面）", limit: 2, basis: [{ lawId: "kaishaku-164", quote: "支持点間の距離をケーブルにあっては2m" }] },
} as const;
const sup = {
  kind: { key: "kind", label: "配管・配線の種類", type: "select", default: "pf_hidden", options: Object.entries(SUPPORT).map(([value, s]) => ({ value, label: s.label })) },
  spacing: { key: "spacing", label: "予定の支持間隔（空欄なら基準だけ表示）", type: "number", unit: "m", min: 0, max: 20 },
} satisfies Record<string, Field>;

export const support: Calc = {
  name: "support_spacing",
  label: "配管・ケーブルの支持間隔",
  description: "金属管・PF/CD管（隠ぺい/露出）・硬質ビニル管・金属製可とう電線管・ケーブルの支持間隔の上限を示し、予定の間隔が収まるかを判定する。",
  fields: Object.values(sup),
  run(p) {
    const k = pick<keyof typeof SUPPORT>(p, sup.kind);
    const s = SUPPORT[k];
    const has = p.spacing !== undefined && p.spacing !== null && p.spacing !== "";
    const x = has ? num(p, sup.spacing) : null;
    const ok = x === null ? null : x <= s.limit;
    return {
      title: `${s.label}の支持間隔`,
      ok,
      verdict: x === null ? `${s.limit}m以下` : `${ok ? "OK" : "NG"}（予定 ${fmt(x)}m ${ok ? "≦" : "＞"} 上限 ${s.limit}m）`,
      steps: [`種類: ${s.label}`, `上限: ${s.limit}m以下`, ...(x === null ? [] : [`予定: ${fmt(x)}m`])],
      basis: [...s.basis],
      notes: [
        "ボックスとの接続点・管端・管相互の接続点の近くでも支持・固定します。",
        ...(k === "pf_exposed" ? ["CD管は露出では使えません（コンクリートに埋め込むか、専用の不燃性・自消性の管やダクトに収める）。"] : []),
        ...(k === "flexible" ? ["垂直で人が触れるおそれのない場合などは 2m 以下にできます（原文を確認）。"] : []),
        "標準仕様書は公共工事の基準です。現場の仕様書も確認してください。",
      ],
    };
  },
};

const rackF = {
  material: { key: "material", label: "ラックの材質", type: "select", default: "steel", options: [{ value: "steel", label: "鋼製" }, { value: "other", label: "その他（アルミ製など）" }] },
  direction: { key: "direction", label: "向き", type: "select", default: "horizontal", options: [{ value: "horizontal", label: "水平" }, { value: "vertical", label: "垂直" }] },
} satisfies Record<string, Field>;

export const rack: Calc = {
  name: "rack_support_spacing",
  label: "ケーブルラックの支持間隔",
  description: "ケーブルラックの水平・垂直の支持間隔の上限（標準仕様書）を示す。",
  fields: Object.values(rackF),
  run(p) {
    const m = pick<"steel" | "other">(p, rackF.material);
    const d = pick<"horizontal" | "vertical">(p, rackF.direction);
    const limit = d === "vertical" ? 3 : m === "steel" ? 2 : 1.5;
    return {
      title: "ケーブルラックの支持間隔",
      ok: null,
      verdict: `${limit}m以下`,
      steps: [`${m === "steel" ? "鋼製" : "鋼製以外"}・${d === "vertical" ? "垂直" : "水平"}`, `上限: ${limit}m以下`],
      basis:
        d === "vertical"
          ? [{ lawId: "shiyo-2.10.1", quote: "ケーブルラックの垂直支持間隔は、3ｍ以下とする。" }]
          : [{ lawId: "shiyo-2.10.1", quote: "ケーブルラックの水平支持間隔は、鋼製では 2ｍ以下、その他については 1.5ｍ以下とする。" }],
      notes: d === "vertical" ? ["配線室などの部分は、6m以下にできる場合があります（原文を確認）。"] : [],
    };
  },
};

// ---------- この資格でできる工事か（電気工事士法） ----------
const lic = {
  facility: { key: "facility", label: "工事する設備", type: "select", default: "general", options: [
    { value: "general", label: "一般用電気工作物等（住宅・小さな店舗など）" },
    { value: "private", label: "自家用電気工作物（最大電力500kW未満の需要設備：ビル・工場など）" },
  ] },
  work: { key: "work", label: "工事の内容", type: "select", default: "normal", options: [
    { value: "normal", label: "ふつうの電気工事（配線・器具の取付けなど）" },
    { value: "simple", label: "600V以下で使う設備の工事（電線路を除く）" },
    { value: "neon", label: "ネオン工事" },
    { value: "generator", label: "非常用予備発電装置の工事" },
  ] },
  license: { key: "license", label: "持っている資格", type: "select", default: "none", options: [
    { value: "none", label: "なし" },
    { value: "second", label: "第二種電気工事士" },
    { value: "first", label: "第一種電気工事士" },
    { value: "certified", label: "認定電気工事従事者" },
    { value: "special", label: "特種電気工事資格者（その工事の分）" },
  ] },
} satisfies Record<string, Field>;

export const license: Calc = {
  name: "license_scope",
  label: "この資格でできる工事か",
  description: "電気工事士法に基づき、持っている資格でその設備・工事の作業に従事できるかを判定する。軽微な工事・軽微な作業は無資格でもできる旨を添える。",
  fields: Object.values(lic),
  run(p) {
    const f = pick<"general" | "private">(p, lic.facility);
    const w = pick<"normal" | "simple" | "neon" | "generator">(p, lic.work);
    const l = pick<"none" | "second" | "first" | "certified" | "special">(p, lic.license);
    let need: string;
    let ok: boolean;
    const basis = [];
    if (f === "general") {
      need = "第一種または第二種電気工事士";
      ok = l === "first" || l === "second";
      basis.push({ lawId: "335AC0000000139-3", quote: "第一種電気工事士又は第二種電気工事士免状の交付を受けている者（以下「第二種電気工事士」という。）でなければ、一般用電気工作物等に係る電気工事の作業" });
    } else if (w === "neon" || w === "generator") {
      need = `特種電気工事資格者（${w === "neon" ? "ネオン工事" : "非常用予備発電装置工事"}）`;
      ok = l === "special";
      basis.push({ lawId: "335AC0000000139-3", quote: "特種電気工事資格者認定証の交付を受けている者（以下「特種電気工事資格者」という。）でなければ" });
    } else if (w === "simple") {
      need = "第一種電気工事士、または認定電気工事従事者";
      ok = l === "first" || l === "certified";
      basis.push({ lawId: "335AC0000000139-3", quote: "第一種電気工事士免状の交付を受けている者（以下「第一種電気工事士」という。）でなければ、自家用電気工作物に係る電気工事" }, { lawId: "335M50000400097-2_3", quote: "電圧六百ボルト以下で使用する自家用電気工作物に係る電気工事" });
    } else {
      need = "第一種電気工事士";
      ok = l === "first";
      basis.push({ lawId: "335AC0000000139-3", quote: "第一種電気工事士免状の交付を受けている者（以下「第一種電気工事士」という。）でなければ、自家用電気工作物に係る電気工事" });
    }
    const lname = lic.license.options!.find((o) => o.value === l)!.label;
    return {
      title: "この資格でできる工事か",
      ok,
      verdict: ok ? `できます（${lname}）` : `この資格ではできません（必要: ${need}）`,
      steps: [`設備: ${lic.facility.options!.find((o) => o.value === f)!.label}`, `工事: ${lic.work.options!.find((o) => o.value === w)!.label}`, `必要な資格: ${need}`, `持っている資格: ${lname}`],
      basis,
      notes: ["資格がなくても、軽微な工事（電気工事士法施行令 第1条）と、有資格者の作業を補助する作業などの軽微な作業（施行規則 第2条）はできます。", "最大電力500kW以上の需要設備は電気工事士法の対象外で、別の決まり（電気主任技術者の監督など）になります。"],
    };
  },
};

// ---------- 監理技術者・専任（建設業法施行令） ----------
const sup2 = {
  prime: { key: "prime", label: "元請けとして受けた工事", type: "boolean", default: true },
  subTotal: { key: "subTotal", label: "下請けに出す金額の合計（税込）", type: "number", unit: "万円", min: 0, default: 0 },
  contract: { key: "contract", label: "この工事の請負代金（税込）", type: "number", unit: "万円", min: 0 },
  building: { key: "building", label: "建築一式工事", type: "boolean", default: false },
  // 第27条 covers nearly every building but private houses, so the safe default is on
  public: { key: "public", label: "施行令第27条の施設（公共工事・学校・病院・共同住宅・事務所・工場・倉庫など。個人の住宅は外す）", type: "boolean", default: true },
} satisfies Record<string, Field>;

export const engineer: Calc = {
  name: "engineer_requirement",
  label: "監理技術者・専任が要るか",
  description: "建設業法施行令第2条・第27条の金額で、主任技術者で足りるか、監理技術者が要るか、専任が要るかを判定する。金額は万円・税込。",
  fields: Object.values(sup2),
  run(p) {
    const prime = flag(p, sup2.prime);
    const sub = num(p, sup2.subTotal);
    const c = num(p, sup2.contract);
    const bld = flag(p, sup2.building);
    const pub = flag(p, sup2.public);
    const subLimit = bld ? 8000 : 5000;
    const dedLimit = bld ? 9000 : 4500;
    const kanri = prime && sub >= subLimit;
    const dedicated = pub && c >= dedLimit;
    const who = kanri ? "監理技術者" : "主任技術者";
    return {
      title: "監理技術者・専任の判定",
      ok: null,
      verdict: `${who}${dedicated ? "（専任が必要）" : "（専任は不要）"}`,
      steps: [
        `下請けに出す合計: ${fmt(sub, 0)}万円（${prime ? "元請け" : "下請けの立場"}）→ 監理技術者の基準 ${fmt(subLimit, 0)}万円${bld ? "（建築一式）" : ""}`,
        kanri ? "元請けで基準以上 → 監理技術者が必要" : prime ? "基準未満 → 主任技術者でよい" : "元請けでない → 主任技術者でよい",
        `請負代金: ${fmt(c, 0)}万円 → 専任の基準 ${fmt(dedLimit, 0)}万円${bld ? "（建築一式）" : ""}`,
        !pub ? "第27条の施設でない → 専任は不要" : dedicated ? "第27条の施設で基準以上 → 専任が必要" : "基準未満 → 専任は不要",
      ],
      basis: [
        { lawId: "331CO0000000273-2", quote: "法第三条第一項第二号の政令で定める金額は、五千万円とする。ただし、同項の許可を受けようとする建設業が建築工事業である場合においては、八千万円とする。" },
        { lawId: "331CO0000000273-27", quote: "工事一件の請負代金の額が四千五百万円（当該建設工事が建築一式工事である場合にあつては、九千万円）以上のものとする。" },
      ],
      notes: ["金額は改正が多いので、e-Gov の現行版（アプリに施行日を表示）で確かめています。"],
    };
  },
};
