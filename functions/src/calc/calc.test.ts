import { test } from "node:test";
import assert from "node:assert/strict";
import { ampacity, voltageDrop } from "./electrical";
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
  assert.match(engineer.run({ prime: true, subTotal: 5000, contract: 9000 }).verdict, /^監理技術者（専任は不要）/);
  assert.match(engineer.run({ prime: true, subTotal: 4999, contract: 4500, public: true }).verdict, /^主任技術者（専任が必要）/);
  assert.match(engineer.run({ prime: true, subTotal: 7000, contract: 8000, building: true }).verdict, /^主任技術者/);
  basisOk(engineer.run({ prime: true, subTotal: 0, contract: 1 }));
});

test("voltage drop: single-phase 2-wire, 2.0mm, 30m, 15A", () => {
  const r = voltageDrop.run({ system: "single2", length: 30, current: 15, conductor: "2.0" });
  // 35.6×30×15 / (1000×3.1416) = 5.10V
  assert.match(r.verdict, /^5\.1V（5\.1%）/);
});

test("ampacity: IV 2.0mm in conduit with 3 wires = 35×1×0.7 = 24.5A", () => {
  const r = ampacity.run({ conductor: "2.0", insulation: "vinyl", ambient: 30, inConduit: 3, load: 20 });
  assert.equal(r.ok, true);
  assert.match(r.verdict, /24\.5A/);
  basisOk(r);
  assert.match(ampacity.run({ conductor: "5.5sq", insulation: "vinyl", ambient: 40, inConduit: 0 }).verdict, /40A/); // 49×√(20/30)=40.0
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
  assert.equal(conduitFill.run({ conduitType: "PF", wire1: "CV3-38", count1: 1, wire2: "IV-14", count2: 1 }).ok, false);
  assert.match(conduitFill.run({ conduitType: "VE", conduitSize: 22, wire1: "IV-2.0", maxCount: true }).verdict, /^11本まで/);
  assert.throws(() => conduitFill.run({ conduitType: "PF", conduitSize: 99, wire1: "IV-2.0", count1: 1 }));
});
