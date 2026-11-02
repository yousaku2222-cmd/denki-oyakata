import { logger } from "firebase-functions";
import { getLawById, lawLabel, quoteIsInOriginal } from "../laws";
import { ampacity, voltageDrop } from "./electrical";
import { engineer, grounding, insulation, license, rack, support } from "./checks";
import { conduitFill } from "./fill";
import { Calc, CalcInputError, CalcResult } from "./types";

import { CONDUITS } from "./conduitData";

// conduit_fill appears once its dimension table is filled in.
export const CALCS: Calc[] = [...(Object.keys(CONDUITS).length ? [conduitFill] : []), voltageDrop, ampacity, insulation, grounding, support, rack, license, engineer];
const byName = new Map(CALCS.map((c) => [c.name, c]));

export type CalcOutput = CalcResult & {
  name: string;
  basisShown: { lawId: string; quote: string; label: string; edition: string }[];
};

/** Runs one calculation. Basis quotes that are not in the original text are dropped (and logged), never shown. */
export function runCalc(name: string, params: Record<string, unknown>): CalcOutput {
  const calc = byName.get(name);
  if (!calc) throw new CalcInputError("その計算はありません");
  const r = calc.run(params ?? {});
  const basisShown = r.basis.flatMap((b) => {
    const law = getLawById(b.lawId);
    if (!law || !quoteIsInOriginal(b.quote, law.text)) {
      logger.error("calc basis quote not found in original", { name, lawId: b.lawId });
      return [];
    }
    return [{ lawId: b.lawId, quote: b.quote.replace(/｜/g, " "), label: lawLabel(law), edition: law.edition }];
  });
  return { ...r, name, basisShown };
}

/** Tool definitions for Claude: it chooses a calculation and fills in the inputs; the code does the math. */
export function calcTools() {
  return CALCS.map((c) => ({
    name: c.name,
    description: `${c.label}: ${c.description}`,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        c.fields.map((f) => [
          f.key,
          f.type === "select"
            ? { type: "string", enum: f.options!.map((o) => o.value), description: `${f.label}（${f.options!.map((o) => `${o.value}=${o.label}`).join(" / ")}）` }
            : f.type === "boolean"
              ? { type: "boolean", description: f.label }
              : { type: "number", description: `${f.label}${f.unit ? `（${f.unit}）` : ""}` },
        ]),
      ),
    },
  }));
}

/** For the 計算 tab: the forms are drawn from these field definitions. */
export async function listCalcs() {
  return { calcs: CALCS.map((c) => ({ name: c.name, label: c.label, description: c.description, fields: c.fields })) };
}
