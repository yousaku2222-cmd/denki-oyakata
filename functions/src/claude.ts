import Anthropic from "@anthropic-ai/sdk";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { recordUsage } from "./usage";

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

/** Lets the model pick tools and fill in their inputs. Returns the tool calls; the caller runs them. */
export async function pickTools(opts: {
  model: string;
  system: string;
  user: string;
  tools: Anthropic.Tool[];
  maxCalls?: number;
}): Promise<{ name: string; input: Record<string, unknown> }[]> {
  const c = getClient();
  if (!c) throw new Error("no api key");
  const res = await c.messages.create({
    model: opts.model,
    max_tokens: 8000, // also covers thinking
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: opts.tools,
    tool_choice: { type: "auto" },
  });
  await recordUsage(opts.model, res.usage);
  // cut off before choosing: the answer goes on without a calculation, but leave a trace
  if (res.stop_reason === "max_tokens") logger.warn(`${opts.model} hit max_tokens choosing tools`, res.usage);
  return res.content
    .flatMap((b) => (b.type === "tool_use" ? [{ name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : []))
    .slice(0, opts.maxCalls ?? 2);
}

/** One request whose reply must match `schema` (structured output). */
export async function jsonCall<T>(opts: {
  model: string;
  system: string;
  user: string | Anthropic.ContentBlockParam[]; // blocks for images
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
  await recordUsage(opts.model, res.usage);
  if (res.stop_reason === "refusal") throw new Error("refused");
  if (res.stop_reason === "max_tokens") throw new Error(`${opts.model} hit max_tokens (${JSON.stringify(res.usage)})`);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}
