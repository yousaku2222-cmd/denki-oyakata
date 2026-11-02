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
}): Promise<T> {
  const c = getClient();
  if (!c) throw new Error("no api key");
  const res = await c.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: { type: "json_schema", schema: opts.schema } },
  });
  if (res.stop_reason === "refusal") throw new Error("refused");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}
