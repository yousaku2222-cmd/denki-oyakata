import { test } from "node:test";
import assert from "node:assert/strict";
import { ampacity, loadToWire, voltageDrop } from "./electrical";
import { engineer, grounding, insulation, license, rack, support } from "./checks";
import { getLawById, quoteIsInOriginal } from "../laws";
import { CalcResult } from "./types";

function basisOk(r: CalcResult) {
  for (const b of r.basis) {
    const law = getLawById(b.lawId);
    assert.ok(law, `law ${b.lawId} exists`);
    assert.ok(quoteIsInOriginal(b.quote, law!.text), `quote in ${b.lawId}: ${b.quote}`);
  }
}

test("insulation: 0.1MΩ for 100V-class circuits", () => {
  const r = insulation.run({ voltage: "le150", measured: 0.08 });
  assert.equal(r.ok, false);
  assert.equal(insulation.run({ voltage: "le150", measured: 0.1 }).ok, true);
  assert.equal(insulation.run({ voltage: "over300", measured: 0.3 }).ok, false);
  basisOk(r);
  basisOk(insulation.run({ voltage: "other300", measured: 1 }));
  basisOk(insulation.run({ voltage: "over300", measured: 1 }));
});

test("grounding: D 100Ω, or 500Ω with a 0.5s breaker; A 10Ω", () => {
  assert.equal(grounding.run({ type: "D", measured: 120 }).ok, false);
  assert.equal(grounding.run({ type: "D", measured: 120, fastBreaker: true }).ok, true);
  assert.equal(grounding.run({ type: "A", measured: 12, fastBreaker: true }).ok, false);
  for (const type of ["A", "C", "D"]) basisOk(grounding.run({ type, measured: 1 }));
});

test("support spacing and racks", () => {
  assert.equal(support.run({ kind: "pf_exposed", spacing: 1.2 }).ok, false);
  assert.equal(support.run({ kind: "pf_hidden", spacing: 1.5 }).ok, true);
  assert.equal(support.run({ kind: "metal" }).ok, null);
  for (const kind of ["metal", "pf_hidden", "pf_exposed", "vinyl", "flexible", "cable"]) basisOk(support.run({ kind }));
  assert.equal(rack.run({ material: "other", direction: "horizontal" }).verdict, "1.5m以下");
  basisOk(rack.run({ material: "steel", direction: "horizontal" }));
  basisOk(rack.run({ material: "steel", direction: "vertical" }));
});

test("license scope", () => {
  assert.equal(license.run({ facility: "general", work: "normal", license: "second" }).ok, true);
  assert.equal(license.run({ facility: "private", work: "normal", license: "second" }).ok, false);
  assert.equal(license.run({ facility: "private", work: "simple", license: "certified" }).ok, true);
  assert.equal(license.run({ facility: "private", work: "neon", license: "first" }).ok, false);
  for (const facility of ["general", "private"]) for (const work of ["normal", "simple", "neon", "generator"]) basisOk(license.run({ facility, work, license: "none" }));
});

test("engineer: 5,000万 subcontract makes a 監理技術者; 4,500万 public makes it dedicated", () => {
  assert.match(engineer.run({ prime: true, subTotal: 5000, contract: 9000, public: false }).verdict, /^監理技術者（専任は不要）/);
  assert.match(engineer.run({ prime: true, subTotal: 0, contract: 4500 }).verdict, /^主任技術者（専任が必要）/); // 第27条 by default
  assert.match(engineer.run({ prime: true, subTotal: 4999, contract: 4500, public: true }).verdict, /^主任技術者（専任が必要）/);
  assert.match(engineer.run({ prime: true, subTotal: 7000, contract: 8000, building: true }).verdict, /^主任技術者/);
  basisOk(engineer.run({ prime: true, subTotal: 0, contract: 1 }));
});

test("voltage drop: single-phase 2-wire, IV 2.0mm, 30m, 15A", () => {
  const r = voltageDrop.run({ system: "single2", length: 30, current: 15, wireType: "IV", size: "2.0", inConduit: 3 });
  // 35.6×30×15 / (1000×3.1416) = 5.10V = 5.1% > 2% (30m) → 8sq は 2.0025% でわずかに超えるので IV 14sq
  assert.match(r.verdict, /^5.1V（5.1%）／電圧降下が目安2%を超えます → IV 14sq 以上/);
  assert.equal(r.ok, false);
});

test("voltage drop: CVT100 double, three-phase 200V, 100m, 500A", () => {
  // A=200, e=30.8×100×500/200000 = 7.7V = 3.85% ≦ 4%; 許容 290×2 = 580A ≧ 500
  const r = voltageDrop.run({ system: "three3", length: 100, current: 500, wireType: "CVT", size: "100", parallel: "2", install: "air" });
  assert.equal(r.ok, true);
  assert.match(r.verdict, /^7.7V（3.9%）／この太さで適正/);
});

test("ampacity: IV 2.0mm in conduit with 3 wires = 35×1×0.7 = 24.5A; CVT by maker table", () => {
  const r = ampacity.run({ wireType: "IV", size: "2.0", inConduit: 3, load: 20 });
  assert.equal(r.ok, true);
  assert.match(r.verdict, /24.5A/);
  basisOk(r);
  assert.match(ampacity.run({ wireType: "IV", size: "5.5", inConduit: 0, ambient: 40 }).verdict, /40A/); // 49×√(20/30)=40.0
  assert.match(ampacity.run({ wireType: "CVT", size: "325", install: "air" }).verdict, /^CVT 325sq：許容電流 635A/);
  assert.match(ampacity.run({ wireType: "CVT", size: "100", install: "duct", parallel: "2" }).verdict, /500A/);
  assert.match(ampacity.run({ wireType: "CV3", size: "38", install: "air", ambient: 32 }).verdict, /147A/); // 140×1.05
  assert.throws(() => ampacity.run({ wireType: "CV1", size: "38", install: "duct" }));
});

test("kW to wire: 37kW three-phase 200V pf0.8 motor", () => {
  // I = 37000/(√3×200×0.8) = 133.5A; motor >50A → ×1.1 = 146.9A → CVT 38sq (155A)
  const r = loadToWire.run({ kw: 37, phase: "three", voltage: 200, pf: 0.8, motor: true, wireType: "CVT", install: "air" });
  assert.match(r.verdict, /^電流 133.5A → CVT 38sq 以上（許容 155A）/);
  basisOk(r);
  assert.match(loadToWire.run({ kw: 37, phase: "three", voltage: 200, pf: 0.8, wireType: "CVT", install: "air", length: 100 }).verdict, /CVT 60sq/);
  // 30.8×100×133.5/(1000×38)=10.8V 5.4%>4; 60: 6.85V 3.4% OK
});

import { conduitFill } from "./fill";
test("conduit fill: VE22 with IV2.0 x3, and auto size", () => {
  // IV2.0 外径3.6 → 10.18mm²×3 = 30.5mm²、VE22 内径22 → 380.1mm² → 8.0%
  const r = conduitFill.run({ conduitType: "VE", conduitSize: 22, wire1: "IV-2.0", count1: 3 });
  assert.equal(r.ok, true);
  assert.match(r.verdict, /VE22: 8(\.0)?% ≦ 32%/);
  assert.ok(r.steps.some((s) => /VE22に IV 2\.0mm は 11本まで/.test(s))); // 0.32×380.1/10.18 = 11.9
  const auto = conduitFill.run({ conduitType: "VE", wire1: "CV3-38", count1: 1, wire2: "IV-14", count2: 1 });
  assert.match(auto.verdict, /^VE54 以上/); // (490.9+45.4)/2042.8 = 26.3%
  assert.match(conduitFill.run({ conduitType: "PF", wire1: "CV3-38", count1: 1, wire2: "IV-14", count2: 1 }).verdict, /^PF54 以上/); // 536.3/2123.7 = 25.3%
  assert.equal(conduitFill.run({ conduitType: "PF", wire1: "CV3-60", count1: 2 }).ok, false);
  assert.match(conduitFill.run({ conduitType: "VE", conduitSize: 22, wire1: "IV-2.0", maxCount: true }).verdict, /^11本まで/);
  assert.throws(() => conduitFill.run({ conduitType: "PF", conduitSize: 99, wire1: "IV-2.0", count1: 1 }));
  // 直線・短い距離は48%: 0.48×380.1/10.18 = 17.9 → 17本
  assert.match(conduitFill.run({ conduitType: "VE", conduitSize: 22, wire1: "IV-2.0", maxCount: true, route: "easy" }).verdict, /^17本まで（占有率48%以下）/);
});

import { cableRack } from "./rack";
test("cable rack: width search, one row per tier", () => {
  // CVT-60 33mm ×10 = 330mm → 80% usable: 500mm (400) is enough, 400mm (320) is not
  const r = cableRack.run({ cable1: "CVT-60", count1: 10, tiers: "1", margin: 20, gap: 0 });
  assert.match(r.verdict, /^必要な幅: 500mm × 1段/);
  assert.equal(cableRack.run({ width: "400", cable1: "CVT-60", count1: 10, tiers: "1", margin: 20 }).ok, false);
  assert.match(cableRack.run({ width: "300", cable1: "CVT-60", count1: 10, tiers: "2", margin: 20 }).verdict, /^収まります: 300mm × 2段/);
});

test("grounding B: 150/Ig, Ig by formula 17-2", () => {
  // 6.6kV, overhead 0, cable 10km: V'=6, (6/3×10 −1)/2 = 9.5 → 1+9.5 = 10.5 → 11A → 150/11 = 13.6Ω
  const r = grounding.run({ type: "B", cutoff: "none", kv: 6.6, overhead: 0, cableLen: 10 });
  assert.match(r.verdict, /^基準値 13\.63Ω以下/); // 150/11 = 13.636… shown cut down
  assert.equal(grounding.run({ type: "B", cutoff: "le1", ig: 10, measured: 50 }).ok, true); // 600/10 = 60Ω
  assert.equal(grounding.run({ type: "B", cutoff: "none", ig: 10, measured: 16 }).ok, false); // 15Ω
  basisOk(r);
});

test("sizes sent as numbers by Claude's tool call: 2 means IV 2.0mm", () => {
  // JSON has no 2.0, so the model's { size: 2.0 } arrives as 2
  assert.match(ampacity.run({ wireType: "IV", size: 2, inConduit: 3 }).verdict, /IV 2\.0mm：許容電流 24\.5A/);
  assert.match(voltageDrop.run({ system: "single2", length: 30, current: 15, wireType: "IV", size: 2, inConduit: 3 }).verdict, /IV 14sq/);
});

test("a value that was not a number (null after JSON) is an error, not the default", () => {
  assert.throws(() => loadToWire.run({ kw: 10, phase: "three", voltage: 200, pf: null, wireType: "CVT", install: "air" }), /力率/);
});

test("boundaries: 以上 / 以下 are inclusive", () => {
  assert.equal(insulation.run({ voltage: "other300", measured: 0.2 }).ok, true); // 0.2MΩ以上
  assert.equal(grounding.run({ type: "D", measured: 100 }).ok, true); // 100Ω以下
  assert.equal(grounding.run({ type: "C", measured: 10.01 }).ok, false);
  assert.equal(support.run({ kind: "vinyl", spacing: 1.5 }).ok, true);
  assert.match(engineer.run({ prime: true, subTotal: 4999.99, contract: 4499.99, public: true }).verdict, /^主任技術者（専任は不要）/);
  // motor feeders: exactly 50A is still ×1.25
  const r = loadToWire.run({ kw: 50 * Math.sqrt(3) * 200 * 0.8 / 1000, phase: "three", voltage: 200, pf: 0.8, motor: true, wireType: "CVT", install: "air" });
  assert.ok(r.steps.some((s) => /× 1\.25/.test(s)), r.steps.join("\n"));
  basisOk(r);
  // 146-4表: 4 wires 0.63, 7 wires 0.49
  assert.match(ampacity.run({ wireType: "IV", size: "2.0", inConduit: 4 }).verdict, /22\.1A/); // 35×0.63 = 22.05
  assert.match(ampacity.run({ wireType: "IV", size: "2.0", inConduit: 7 }).verdict, /17\.2A/); // 35×0.49 = 17.15
});

test("CD管 is not offered for exposed runs; mixed racks cite 第168条", () => {
  const r = support.run({ kind: "pf_exposed" });
  assert.match(r.title, /^PF管（露出）/);
  assert.ok(r.notes.some((n) => /CD管は露出では使えません/.test(n)));
  basisOk(r);
  basisOk(cableRack.run({ cable1: "HVCVT-38", count1: 2, cable2: "CVT-38", count2: 3, tiers: "1", margin: 20, gap: 0 }));
  basisOk(cableRack.run({ cable1: "HVCVT-38", count1: 2, cable2: "CVT-38", count2: 3, tiers: "1", margin: 20, gap: 0, barrier: true }));
});

import { branchWire } from "./electrical";
test("branch circuit wire by 149-1表: 20A配線用遮断器 is 1.6mm, no conduit derating", () => {
  assert.match(branchWire.run({ amps: 20, breakerKind: "mccb" }).verdict, /^1\.6mm 以上/);
  assert.equal(branchWire.run({ amps: 20, breakerKind: "mccb", size: "1.6" }).ok, true);
  assert.match(branchWire.run({ amps: 20, breakerKind: "other" }).verdict, /^2\.0mm 以上/);
  assert.match(branchWire.run({ amps: 15, breakerKind: "other" }).verdict, /^1\.6mm 以上/); // 15A以下
  assert.match(branchWire.run({ amps: 30 }).verdict, /^2\.6mm 以上/);
  assert.equal(branchWire.run({ amps: 30, size: "5.5" }).ok, true); // 49A ≧ 48A: same or more
  assert.match(branchWire.run({ amps: 40 }).verdict, /^8sq 以上/);
  assert.equal(branchWire.run({ amps: 40, size: "5.5" }).ok, false);
  assert.match(branchWire.run({ amps: 50 }).verdict, /^14sq 以上/);
  assert.throws(() => branchWire.run({ amps: 60 }), /50以下/);
  basisOk(branchWire.run({ amps: 20 }));
});

test("conduit fill uses 電線1's default when the model leaves it out", () => {
  assert.match(conduitFill.run({ conduitType: "VE", conduitSize: 22 }).verdict, /^入ります/); // IV 2.0 ×3
});

test("the figures in a verdict never contradict it", () => {
  assert.match(insulation.run({ voltage: "le150", measured: 0.0999 }).verdict, /0\.0999MΩ ＜ 基準 0\.1MΩ/);
  assert.match(grounding.run({ type: "C", measured: 10.004 }).verdict, /10\.004Ω ＞ 基準 10Ω/);
  assert.match(engineer.run({ prime: true, subTotal: 4999.99, contract: 1 }).steps[0], /4,999\.99万円/);
});

test("exact limits pass: no floating-point noise in a verdict", () => {
  // IV 2.6mm in a conduit: 48 × 1 × 0.7 = 33.6A exactly
  assert.equal(ampacity.run({ wireType: "IV", size: "2.6", inConduit: 3, load: 33.6 }).ok, true);
  assert.match(voltageDrop.run({ system: "single2", length: 10, current: 33.6, wireType: "IV", size: "2.6", inConduit: 3 }).steps.join("\n"), /33\.6A ≧ 負荷 33\.6A … ○/);
  // VE16 (18mm) with 8 × IV 2.0 (3.6mm) is exactly 32%
  const r = conduitFill.run({ conduitType: "VE", conduitSize: "16", wire1: "IV-2.0", count1: 8 });
  assert.equal(r.ok, true, r.verdict);
  assert.match(conduitFill.run({ conduitType: "VE", conduitSize: "16", wire1: "IV-2.0", maxCount: true }).verdict, /^8本まで/);
  // B種: the limit is shown cut down, and the shown figures agree with the verdict
  assert.match(grounding.run({ type: "B", cutoff: "none", ig: 7 }).verdict, /^基準値 21\.42Ω以下/);
  assert.match(grounding.run({ type: "B", cutoff: "none", ig: 7, measured: 21.42 }).verdict, /^合格（測定 21\.42Ω ≦/);
  assert.match(grounding.run({ type: "C", measured: 10.0000001 }).verdict, /10\.0000001Ω ＞ 基準 10Ω/);
  assert.ok(insulation.run({ voltage: "le150", measured: 0.0999 }).steps.includes("測定値: 0.0999MΩ"));
});

test("currents exactly at a boundary are not pushed over it by floating-point noise", () => {
  // 7560 ÷ (210 × 0.72) = 50A exactly: a motor feeder at 50A is ×1.25 (62.5A), not ×1.1
  const r = loadToWire.run({ kw: 7.56, phase: "single", voltage: 210, pf: 0.72, motor: true, wireType: "CVT", install: "air" });
  assert.ok(r.steps.some((s) => /50A ≦ 50A → × 1\.25 = 62\.5A/.test(s)), r.steps.join("\n"));
  assert.match(r.verdict, /CVT 14sq/);
  // 100A × 1.1 = 110A exactly: CVT 22sq (110A) is enough
  assert.match(loadToWire.run({ kw: 20, phase: "single", voltage: 200, pf: 1, motor: true, wireType: "CVT", install: "air" }).verdict, /CVT 22sq/);
  // exactly 2% voltage drop is within the 2% limit
  assert.doesNotMatch(voltageDrop.run({ system: "single2", voltage: 89, length: 17.6, current: 62.5, wireType: "CV1", size: "22", install: "air" }).verdict, /超えます/);
  // how many fit: the working line is cut, never rounded up past the count
  assert.ok(conduitFill.run({ conduitType: "VE", conduitSize: "36", wire1: "VVF-2.0×3C", maxCount: true, route: "easy" }).steps.some((s) => /= 4\.\d+… → 切り捨てて 4本/.test(s)));
  // B種: the limit in the verdict is the same cut-down figure as in the steps
  const b = grounding.run({ type: "B", cutoff: "none", ig: 9, measured: 5 });
  assert.match(b.verdict, /基準 16\.66Ω/);
  assert.match(grounding.run({ type: "B", cutoff: "none", ig: 7, measured: 21.425 }).verdict, /^合格（測定 21\.425Ω ≦ 基準 21\.428Ω）/);
});

test("over 60m, the drop is compared on the total when the rest is given, and said to be one section when not", () => {
  const base = { system: "three3", length: 100, current: 50, wireType: "CV3", size: "38", install: "air" };
  const one = voltageDrop.run(base);
  assert.match(one.verdict, /この区間だけの降下です/);
  // with the trunk's 6V on top, the same section goes over the 4% for 100m
  const total = voltageDrop.run({ ...base, otherDrop: 6 });
  assert.doesNotMatch(total.verdict, /この区間だけ/);
  assert.match(total.verdict, /合計/);
  assert.equal(total.ok, false);
  assert.match(total.steps.join("\n"), /この区間以外の降下 6V を足すと/);
  // up to 60m each section has its own 2%: the rest is shown, not added to the judgement
  const short = voltageDrop.run({ system: "single2", length: 30, current: 15, wireType: "IV", size: "2.0", inConduit: 3 });
  assert.equal(voltageDrop.run({ system: "single2", length: 30, current: 15, wireType: "IV", size: "2.0", inConduit: 3, otherDrop: 50 }).ok, short.ok);
  assert.ok(voltageDrop.fields.some((f) => f.key === "otherDrop" && f.unit === "V" && f.default === undefined));
});

test("a 認定電気工事従事者 can do ordinary wiring in 自家用 (600V以下 is the default), and 一般用 does not ask the work", () => {
  assert.equal(license.run({ facility: "private", license: "certified" }).ok, true);
  assert.equal(license.run({ facility: "private", work: "normal", license: "certified" }).ok, false); // 高圧・電線路
  assert.ok(!license.run({ facility: "general", license: "second" }).steps.some((x) => x.startsWith("工事:")));
});

test("the PF exposed support spacing does not cite the CD管 sentence", () => {
  assert.ok(!support.run({ kind: "pf_exposed" }).basis.some((b) => b.lawId === "kaishaku-158"));
});
