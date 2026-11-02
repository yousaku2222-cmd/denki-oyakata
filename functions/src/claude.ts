import Anthropic from "@anthropic-ai/sdk";
import { defineSecret } from "firebase-functions/params";

export const anthropicKey = defineSecret("ANTHROPIC_API_KEY");

let client: Anthropic | null | undefined;

/** Returns null when no API key is configured: callers then fall back to dummy answers. */
export function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  let key = "";
  try {
    key = anthropicKey.value();
  } catch {
    key = process.env.ANTHROPIC_API_KEY ?? "";
  }
  client = key.trim() ? new Anthropic({ apiKey: key.trim() }) : null;
  return client;
}

/** One request whose reply must match `schema` (structured output). */
export async function jsonCall<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const c = getClient();
  if (!c) throw new Error("no api key");
  // max_tokens also covers thinking, so leave headroom above the JSON itself.
  const res = await c.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: { type: "json_schema", schema: opts.schema }, ...(opts.effort ? { effort: opts.effort } : {}) },
  });
  if (res.stop_reason === "refusal") throw new Error("refused");
  if (res.stop_reason === "max_tokens") throw new Error(`${opts.model} hit max_tokens (${JSON.stringify(res.usage)})`);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}
