// Representative dimensions for the conduit fill calculation (mm), from manufacturers' public documents based on JIS.
// Where makers differ, the smaller inner diameter is used (the safe side). Values marked "D-2t" are outer diameter
// minus twice the wall thickness, as the makers publish no inner diameter for steel conduit.

export interface WireSpec {
  label: string;
  d?: number; // finished outer diameter (round)
  long?: number; // flat cable (VVF): major x minor
  short?: number;
  hv?: boolean; // high-voltage cable
}
export interface ConduitSpec {
  label: string;
  short: string;
  sizes: Record<string, number>; // nominal size -> inner diameter
}

// IV (JIS C 3307) / HIV: SWCC 産業用電線ケーブル vol.4 p.6 構造・性能表、SWCC SF-0010B、HS&T HST-SS10-0002（3資料で一致）
// 100sq以上: 矢崎 IV仕様書（200まで）・SWCC 370.pdf・販売店掲載カタログ 440.pdf（一致）
const IV: [string, number][] = [["1.6", 3.2], ["2.0", 3.6], ["2.6", 4.6], ["5.5", 5.0], ["8", 6.0], ["14", 7.6], ["22", 9.2], ["38", 11.5], ["60", 14.0], ["100", 17.0], ["150", 21], ["200", 23], ["250", 26], ["325", 29]];
// VVF (JIS C 3342): HS&T 600V VVF、SWCC SF-0039（2資料で一致）
const VVF: [string, number, number][] = [["1.6×2C", 9.4, 6.2], ["1.6×3C", 13.0, 6.2], ["2.0×2C", 10.5, 6.6], ["2.0×3C", 14.0, 6.6], ["2.6×2C", 12.5, 7.6]];
// CV (JIS C 3605): 古河電工 電設資材ガイド2016〜2017 構造表、100sq以上は古河(925/926.pdf)・SWCC(916.pdf)・矢崎 仕様書のうち大きい方
const CV1: [string, number][] = [["5.5", 8.0], ["8", 8.6], ["14", 9.4], ["22", 11.0], ["38", 13.0], ["60", 15.5], ["100", 19.0], ["150", 22], ["200", 26], ["250", 28], ["325", 31]];
const CV3: [string, number][] = [["5.5", 14.5], ["8", 16.0], ["14", 17.5], ["22", 21], ["38", 25], ["60", 31], ["100", 40], ["150", 46], ["200", 54], ["250", 59], ["325", 65]];
const CVT: [string, number][] = [["8", 19.0], ["14", 21], ["22", 24], ["38", 28], ["60", 33], ["100", 41], ["150", 47], ["200", 55], ["250", 60], ["325", 66]];
// 6600V CVT（より合せ外径）: 矢崎 6kV-CVT(EE)仕様書（SWCC 915.pdf より大きい方）
const HVCVT: [string, number][] = [["22", 42], ["38", 46], ["60", 51], ["100", 58], ["150", 65], ["200", 73], ["250", 78], ["325", 85]];

const unit = (s: string) => (s.includes(".") && Number(s) < 3 ? `${s}mm` : `${s}sq`);
export const WIRES: Record<string, WireSpec> = Object.fromEntries([
  ...IV.map(([s, d]) => [`IV-${s}`, { label: `IV ${unit(s)}`, d }]),
  ...VVF.map(([s, l, sh]) => [`VVF-${s}`, { label: `VVF ${s}`, long: l, short: sh }]),
  ...CV1.map(([s, d]) => [`CV1-${s}`, { label: `CV ${s}sq 単心`, d }]),
  ...CV3.map(([s, d]) => [`CV3-${s}`, { label: `CV ${s}sq 3心`, d }]),
  ...CVT.map(([s, d]) => [`CVT-${s}`, { label: `CVT ${s}sq`, d }]),
  ...HVCVT.map(([s, d]) => [`HVCVT-${s}`, { label: `6600V CVT ${s}sq`, d, hv: true }]),
]);

export const CONDUITS: Record<string, ConduitSpec> = {
  // 積水化学 承認図 E-VE01 の D-2t と未来工業の近似内径のうち小さい方（100 は未来工業、JIS C 8430 の対象外）
  VE: { label: "硬質ビニル電線管（VE）", short: "VE", sizes: { 14: 14, 16: 18, 22: 22, 28: 28, 36: 35, 42: 40, 54: 51, 70: 67, 82: 77, 100: 100 } },
  // 未来工業 ミラフレキSS/MF/SD・パナソニック パナフレキ・古河電工 プラフレキ（PFS・PFD）の小さい方
  PF: { label: "合成樹脂製可とう電線管（PF管）", short: "PF", sizes: { 14: 14, 16: 16, 22: 22, 28: 28, 36: 36, 42: 40, 54: 52 } },
  // 未来工業 ミラフレキCD・パナソニック・古河電工 プラフレキCD の小さい方
  CD: { label: "CD管", short: "CD", sizes: { 14: 14, 16: 16, 22: 22, 28: 27, 36: 35, 42: 42, 54: 54 } },
  // パナソニック・丸一鋼管の外径・厚さから D-2t（E75 は厚い方の 1.8 で計算）
  E: { label: "ねじなし電線管（E）", short: "E", sizes: { 19: 16.7, 25: 23.0, 31: 29.0, 39: 35.3, 51: 48.0, 63: 60.3, 75: 72.6 } },
  C: { label: "薄鋼電線管（C）", short: "C", sizes: { 19: 15.9, 25: 22.2, 31: 28.6, 39: 34.9, 51: 47.6, 63: 59.5, 75: 72.2 } },
  G: { label: "厚鋼電線管（G）", short: "G", sizes: { 16: 16.4, 22: 21.9, 28: 28.3, 36: 36.9, 42: 42.8, 54: 54.0, 70: 69.6, 82: 82.3, 92: 93.7, 104: 106.4 } },
  // 古河電工 エフレックス・未来工業 ミラレックスF の小さい方（20 は未来工業のみ）
  FEP: { label: "波付硬質合成樹脂管（FEP）", short: "FEP", sizes: { 20: 21, 30: 30, 40: 41, 50: 50, 65: 66, 80: 80, 100: 100, 125: 125, 150: 147, 200: 200 } },
  // 三桂製作所 標準プリカPZ・パナソニック ハイフレックス（一致、最小内径）
  PLICA: { label: "金属製可とう電線管（プリカ・2種）", short: "プリカ", sizes: { 10: 9.2, 12: 11.4, 15: 14.1, 17: 16.6, 24: 23.8, 30: 29.3, 38: 37.1, 50: 49.1, 63: 62.6, 76: 76.0, 83: 81.0, 101: 100.2 } },
};
