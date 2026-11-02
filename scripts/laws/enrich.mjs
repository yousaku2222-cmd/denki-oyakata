// One-off: Claude Opus reads each article and adds a plain-language summary, search words and scenes
// ("law cards"). The original text is kept untouched for quote verification.
// Usage: node scripts/laws/enrich.mjs   (reads ANTHROPIC_API_KEY from functions/.secret.local)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const Anthropic = require("@anthropic-ai/sdk").default;
const MODEL_HEAVY = "claude-opus-5-5"; // same as functions/src/models.ts

const dataDir = new URL("../../functions/data/", import.meta.url);
const source = JSON.parse(readFileSync(new URL("laws.source.json", dataDir), "utf8"));
const outPath = new URL("laws.json", dataDir);
const done = existsSync(outPath) ? Object.fromEntries(JSON.parse(readFileSync(outPath, "utf8")).map((l) => [l.id, l])) : {};

const key = readFileSync(new URL("../../functions/.secret.local", import.meta.url), "utf8").match(/ANTHROPIC_API_KEY=(.*)/)[1].trim();
const client = new Anthropic({ apiKey: key });

const SYSTEM = `電気工事の若手（資格なし〜第一種電気工事士）が現場で引く「法令カード」を作ります。渡された条文の原文だけを根拠にしてください。
- summary: 何を決めている条文か、現場の言葉で2〜4文。数値は原文どおり（漢数字は算用数字にしてよい）。原文に無いことは書かない。
- keywords: 若手が質問に使いそうな言葉を8〜15個。部材・工事の正式名と現場の呼び名・略称（例: 合成樹脂可とう電線管→PF管、硬質ビニル電線管→VE管、ケーブル→VVF・Fケーブル）、数値の種類（支持間隔、接地抵抗、絶縁抵抗 など）。
- scenes: この条文を引く現場の場面を2〜4個、短い文で（例「天井裏でPF管を支持する時」）。`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    scenes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "keywords", "scenes"],
  additionalProperties: false,
};

let inTok = 0, outTok = 0;
async function enrich(l) {
  if (done[l.id]?.text === l.text) return done[l.id];
  const res = await client.messages.create({
    model: MODEL_HEAVY,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: `${l.lawName}（${l.edition}） ${l.article}【${l.heading}】\n\n${l.text}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: "medium" },
  });
  if (res.stop_reason !== "end_turn") throw new Error(`${l.id}: ${res.stop_reason}`);
  inTok += res.usage.input_tokens;
  outTok += res.usage.output_tokens;
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { ...l, ...JSON.parse(text) };
}

const out = [];
const queue = [...source];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const l = queue.shift();
      const r = await enrich(l);
      out.push(r);
      console.log(`${r.id}\t${r.summary.slice(0, 50)}`);
    }
  }),
);
out.sort((a, b) => source.findIndex((s) => s.id === a.id) - source.findIndex((s) => s.id === b.id));
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`done ${out.length}  tokens in=${inTok} out=${outTok}  ≈ $${((inTok * 4 + outTok * 20) / 1e6).toFixed(2)}`);
