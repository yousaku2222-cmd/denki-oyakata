// Calculations and checks are done by code, never by the model. The model only picks one and fills in the inputs.

export interface Field {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  unit?: string;
  options?: { value: string; label: string }[];
  default?: number | string | boolean;
  min?: number;
  max?: number;
  help?: string;
}

/** A sentence of the original text that the result relies on. Checked word for word in tests and at run time. */
export interface Basis {
  lawId: string;
  quote: string;
}

export interface FillFigure {
  kind: "fill";
  innerDiameter: number; // mm
  wires: { label: string; diameter: number; count: number }[]; // round equivalent diameter, mm
}

export interface CalcResult {
  title: string;
  ok: boolean | null; // null = no pass/fail, just a number
  verdict: string; // one line, e.g. "合格（0.52MΩ ≧ 0.1MΩ）"
  steps: string[]; // how we got there, shown to the user
  basis: Basis[];
  notes: string[]; // e.g. "数値は代表値"
  figure?: FillFigure;
}

export interface Calc {
  name: string; // tool name for Claude, also the id in the UI
  label: string;
  description: string; // for Claude: when to use it
  fields: Field[];
  run(p: Record<string, unknown>): CalcResult;
}

// --- input helpers (values come from the model or a form: never trust them) ---
export class CalcInputError extends Error {}

export function num(p: Record<string, unknown>, f: Field): number {
  const v = p[f.key] ?? f.default;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new CalcInputError(`${f.label}を数字で入れてください`);
  if (f.min !== undefined && n < f.min) throw new CalcInputError(`${f.label}は${f.min}以上で入れてください`);
  if (f.max !== undefined && n > f.max) throw new CalcInputError(`${f.label}は${f.max}以下で入れてください`);
  return n;
}

export function pick<T extends string>(p: Record<string, unknown>, f: Field): T {
  const v = p[f.key] ?? f.default;
  if (typeof v !== "string" || !f.options?.some((o) => o.value === v)) throw new CalcInputError(`${f.label}を選んでください`);
  return v as T;
}

export function flag(p: Record<string, unknown>, f: Field): boolean {
  const v = p[f.key] ?? f.default;
  return v === true || v === "true";
}

export const fmt = (n: number, digits = 2) => Number(n.toFixed(digits)).toLocaleString("ja-JP");
