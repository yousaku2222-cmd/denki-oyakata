import { WIRES } from "./conduitData";
import { Basis, Calc, CalcInputError, Field, fmt, num, pick } from "./types";

// Cable rack layout: cables are laid side by side in one layer on each tier (no stacking on a tier).
// With two tiers, high-voltage cables get a tier of their own when they fit; on a shared tier they are kept
// 15cm away from the low-voltage cables, or a fire-resistant barrier is put between them (解釈 第168条第2項).
const WIDTHS = [200, 300, 400, 500, 600, 800, 1000];
const HV_GAP = 150;

const cableOptions = () => Object.entries(WIRES).map(([value, w]) => ({ value, label: w.label }));
const SLOTS = 5;
const f = {
  width: { key: "width", label: "ラックの幅", type: "select", default: "600", emptyLabel: "（自動で必要な幅を探す）", options: WIDTHS.map((w) => ({ value: String(w), label: `${w}mm` })) },
  tiers: { key: "tiers", label: "ラックの段数", type: "select", default: "1", options: [{ value: "1", label: "1段" }, { value: "2", label: "2段" }] },
  margin: { key: "margin", label: "将来の増設のための空き", type: "number", unit: "%", default: 20, min: 0, max: 80 },
  gap: { key: "gap", label: "ケーブルとケーブルの間隔", type: "number", unit: "mm", default: 0, min: 0, max: 200, help: "0なら密着して並べます" },
  barrier: { key: "barrier", label: "高圧と低圧の間に耐火性の隔壁（セパレータ）を入れる", type: "boolean", default: false },
  ...Object.fromEntries(
    Array.from({ length: SLOTS }, (_, i) => [
      [`cable${i + 1}`, { key: `cable${i + 1}`, label: `ケーブル${i + 1}`, type: "select", ...(i === 0 ? { default: "CVT-100" } : {}), options: cableOptions() }],
      [`count${i + 1}`, { key: `count${i + 1}`, label: `ケーブル${i + 1}の条数`, type: "number", unit: "条", ...(i === 0 ? { default: 2 } : {}), min: 0, max: 200 }],
    ]).flat(),
  ),
} as Record<string, Field>;

interface Item {
  label: string;
  width: number; // mm across the rack
  hv: boolean;
}
export interface RackTier {
  cables: { label: string; x: number; d: number; hv: boolean }[];
  barrierAt?: number; // x of the barrier (mm from the left)
}

/** Lays the items on tiers of the given width; returns null if they do not fit. */
function layout(items: Item[], width: number, tiers: number, gap: number, barrier: boolean, usable: number) {
  const hv = items.filter((i) => i.hv);
  const lv = items.filter((i) => !i.hv);
  const span = (list: Item[]) => list.reduce((s, i) => s + i.width, 0) + gap * Math.max(0, list.length - 1);
  const limit = width * usable;
  // two tiers: high voltage alone on the upper tier, the rest below (split the low voltage if it overflows)
  if (tiers === 2 && hv.length && span(hv) <= limit) {
    const rest = fill([...lv], limit, gap);
    if (rest.length <= 1) return [place(hv, gap), place(rest[0] ?? [], gap)];
  }
  const shared = (list: Item[]) => {
    // a tier holding both: high voltage on the left, then 15cm (or a barrier), then low voltage
    const h = list.filter((i) => i.hv);
    const l = list.filter((i) => !i.hv);
    if (!h.length || !l.length) return { used: span(list), tier: place(list, gap) };
    const sep = barrier ? Math.max(gap, 20) : HV_GAP;
    const left = place(h, gap);
    const at = span(h) + sep / 2;
    const right = place(l, gap, span(h) + sep);
    return { used: span(h) + sep + span(l), tier: { cables: [...left.cables, ...right.cables], barrierAt: barrier ? at : undefined } };
  };
  if (tiers === 1) {
    const s = shared(items);
    return s.used <= limit ? [s.tier] : null;
  }
  // two tiers, mixed: first-fit by width, keeping high voltage together on the first tier
  const groups = fill([...hv, ...lv], limit, gap);
  if (groups.length > 2) return null;
  const out = groups.map((g) => shared(g));
  return out.every((s) => s.used <= limit) ? out.map((s) => s.tier) : null;
}

function fill(items: Item[], limit: number, gap: number) {
  const groups: Item[][] = [];
  let cur: Item[] = [];
  let used = 0;
  for (const i of items) {
    const add = (cur.length ? gap : 0) + i.width;
    if (cur.length && used + add > limit) {
      groups.push(cur);
      cur = [];
      used = 0;
    }
    used += cur.length ? gap + i.width : i.width;
    cur.push(i);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function place(list: Item[], gap: number, start = 0): RackTier {
  let x = start;
  return {
    cables: list.map((i) => {
      const c = { label: i.label, x, d: i.width, hv: i.hv };
      x += i.width + gap;
      return c;
    }),
  };
}

export const cableRack: Calc = {
  name: "cable_rack_layout",
  label: "ケーブルラックの配置",
  description:
    "ケーブルラック（1段・2段）にケーブルを1列に並べたとき、幅に収まるか・何%使うかを計算し、必要なラック幅を探す。高圧ケーブルがあれば低圧との離隔（15cm、または隔壁）を確かめる。ラックの幅を省くと、収まる一番狭い幅を探す。",
  fields: Object.values(f),
  run(p) {
    const items: Item[] = [];
    for (let i = 1; i <= SLOTS; i++) {
      if (!p[`cable${i}`]) continue;
      const count = Math.round(num(p, f[`count${i}`]));
      const key = pick<string>(p, f[`cable${i}`]);
      const w = WIRES[key];
      const width = w.long ?? w.d!;
      for (let k = 0; k < count; k++) items.push({ label: w.label, width, hv: !!w.hv });
    }
    if (!items.length) throw new CalcInputError("ケーブルを1つ以上選んでください");
    items.sort((a, b) => Number(b.hv) - Number(a.hv) || b.width - a.width);
    const tiers = Number(pick(p, f.tiers));
    const margin = num(p, f.margin);
    const gap = num(p, f.gap);
    const barrier = p.barrier === true || p.barrier === "true";
    const usable = 1 - margin / 100;
    const wanted = p.width === undefined || p.width === null || p.width === "" ? null : Number(pick(p, f.width));

    const tryWidth = (w: number) => layout(items, w, tiers, gap, barrier, usable);
    const width = wanted ?? WIDTHS.find((w) => tryWidth(w)) ?? null;
    const result = width === null ? null : tryWidth(width);
    const hasHv = items.some((i) => i.hv);
    const mixed = hasHv && items.some((i) => !i.hv);

    const total = items.reduce((s, i) => s + i.width, 0);
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
    const listText = [...counts].map(([l, n]) => `${l}×${n}条`).join("＋");
    const steps = [
      ...[...counts].map(([l, n]) => `${l}: 外径 ${items.find((i) => i.label === l)!.width}mm × ${n}条`),
      `外径の合計: ${fmt(total, 1)}mm${gap ? `（ほかに間隔 ${gap}mm ずつ）` : ""}`,
      `使ってよい幅: ラック幅 × ${fmt(usable * 100, 0)}%（空き ${margin}% を残す）`,
    ];
    const basis: Basis[] = [];
    if (mixed) {
      basis.push({ lawId: "kaishaku-168", quote: "高圧屋内配線と他の屋内電線等との離隔距離は、15cm" });
      if (barrier) basis.push({ lawId: "kaishaku-168", quote: "ケーブルと他の屋内電線等との間に耐火性のある堅ろうな隔壁を設けること。" });
    }
    const notes = [
      "外径はメーカー公表の代表値です。製品によって違うことがあります。",
      "ケーブルは各段に1列で並べる前提です（重ねない）。多条で並べると許容電流が下がることがあるので、メーカーの低減率を確認してください。",
    ];
    if (mixed && tiers === 2) notes.push("高圧と低圧を別の段に分けたときは、段と段の間を15cm以上あけてください（または隔壁）。");

    if (!result || width === null) {
      // say what would work: a wider rack with the same tiers, or two tiers of this width
      const wider = WIDTHS.find((w) => w > (wanted ?? 0) && tryWidth(w));
      const twoTiers = tiers === 1 && wanted && layout(items, wanted, 2, gap, barrier, usable) ? `、${wanted}mm×2段なら収まります` : "";
      const hint = wider ? ` → ${wider}mm幅なら収まります${twoTiers}` : twoTiers ? ` → ${twoTiers.slice(1)}` : "";
      return {
        title: `ケーブルラックの配置（${listText}）`,
        ok: false,
        verdict: (wanted ? `${wanted}mm・${tiers}段には収まりません` : `${tiers}段では1000mm幅にも収まりません`) + hint,
        steps,
        basis,
        notes,
      };
    }
    const used = result.map((t) => {
      const last = t.cables[t.cables.length - 1];
      return last ? last.x + last.d : 0;
    });
    steps.push(...result.map((t, i) => `${result.length > 1 ? `${i === 0 ? "上" : "下"}の段: ` : ""}${t.cables.length}条・${fmt(used[i], 0)}mm → ${fmt((used[i] / width) * 100, 1)}%`));
    const sharedTier = result.some((t) => t.cables.some((c) => c.hv) && t.cables.some((c) => !c.hv));
    if (sharedTier) steps.push(barrier ? "同じ段の高圧と低圧の間: 耐火性の隔壁" : `同じ段の高圧と低圧の間を ${HV_GAP}mm あける`);
    else if (mixed) steps.push("高圧と低圧は別の段に分けました");
    return {
      title: `ケーブルラックの配置（${listText}）`,
      ok: true,
      verdict: `${wanted ? "収まります" : "必要な幅"}: ${width}mm × ${tiers}段（使用率 ${result.map((_, i) => `${fmt((used[i] / width) * 100, 0)}%`).join("・")}）`,
      steps,
      basis,
      notes,
      figure: { kind: "rack", width, tiers: result },
    };
  },
};
