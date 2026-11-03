import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";
import { MODEL_ANSWER, MODEL_HEAVY, MODEL_ROUTER } from "./models";

// US dollars per million tokens: [input, output, cache read]. Keep in step with models.ts.
const PRICE: Record<string, [number, number, number]> = {
  [MODEL_ROUTER]: [0.1, 0.5, 0.01],
  [MODEL_ANSWER]: [2, 10, 0.2],
  [MODEL_HEAVY]: [4, 20, 0.2],
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
}

export function costUsd(model: string, u: Usage): number {
  const [i, o, r] = PRICE[model] ?? PRICE[MODEL_HEAVY]; // an unknown model is counted at the top price
  return (u.input_tokens * i + u.output_tokens * o + (u.cache_read_input_tokens ?? 0) * r) / 1e6;
}

/** The day in Japan time, so a day's total matches the day people used it. */
export const jstDay = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * Adds one Claude call to the day's total (usage/<YYYY-MM-DD>, closed to clients by the rules).
 * Counting must never break an answer, so a failed write is only logged.
 */
export async function recordUsage(model: string, u: Usage): Promise<void> {
  const inc = FieldValue.increment;
  const usd = costUsd(model, u);
  try {
    await db
      .doc(`usage/${jstDay()}`)
      .set(
        { usd: inc(usd), calls: inc(1), models: { [model]: { calls: inc(1), input: inc(u.input_tokens), output: inc(u.output_tokens), usd: inc(usd) } } },
        { merge: true },
      );
  } catch (e) {
    console.warn("recordUsage failed", e);
  }
}
