// One-off: adds `plain` to each law card in functions/data/laws.json: the gist in 2-4 short points for a
// beginner, and the hard words said plainly. The longer `summary` stays (search uses it; the sheet shows it
// under くわしい要約). A point with a number the original text does not have is dropped, like answers are.
// Usage: node scripts/laws/plain.mjs [--all]   (reads ANTHROPIC_API_KEY from functions/.secret.local, needs a build of functions/)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const Anthropic = require("@anthropic-ai/sdk").default;
const { MODEL_ANSWER } = require("./lib/models.js");
const { numbersMissing } = require("./lib/laws.js");

const path = new URL("../../functions/data/laws.json", import.meta.url);
const laws = JSON.parse(readFileSync(path, "utf8"));
const key = readFileSync(new URL("../../functions/.secret.local", import.meta.url), "utf8").match(/ANTHROPIC_API_KEY=(.*)/)[1].trim();
const client = new Anthropic({ apiKey: key });

const SYSTEM = `電気工事の1年目の若手（資格なし）が、スマホで条文を開いた時に最初に読む「かんたんに言うと」を作ります。渡された条文の原文だけを根拠にしてください。
- points: この条文が決めていることを2〜4個。1つ40字以内。現場の言葉で、専門用語はできるだけ言い換える（例「造営材」→「柱や梁などの建物の材料」）。数値は原文どおり（漢数字は算用数字にしてよい）。原文に無いことは書かない。若手が現場で一番知りたいことを先に。
- words: points に残った専門用語のうち、1年目が分からなさそうなものを0〜3個、{term, plain}（plain は20字以内）。`;

const SCHEMA = {
  type: "object",
  properties: {
    points: { type: "array", items: { type: "string" } },
    words: { type: "array", items: { type: "object", properties: { term: { type: "string" }, plain: { type: "string" } }, required: ["term", "plain"], additionalProperties: false } },
  },
  required: ["points", "words"],
  additionalProperties: false,
};

let dropped = 0;
async function plainOf(l) {
  const res = await client.messages.create({
    model: MODEL_ANSWER,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: `${l.lawName} ${l.article}【${l.heading}】\n原文:\n${l.text}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const r = JSON.parse(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  const points = r.points.filter((p) => {
    const bad = numbersMissing(p, l.text).length > 0;
    if (bad) dropped++;
    return !bad;
  });
  return { points: points.slice(0, 4), words: r.words.slice(0, 3) };
}

for (let i = 0; i < laws.length; i += 6) {
  await Promise.all(
    laws.slice(i, i + 6).map(async (l) => {
      // only the ones without it: points already there may have been fixed by hand (--all makes them all again)
      if (l.plain && !process.argv.includes("--all")) return;
      l.plain = await plainOf(l);
      console.log(`${l.id}: ${l.plain.points.length} points`);
    }),
  );
}
writeFileSync(path, JSON.stringify(laws, null, 1));
console.log(`done: ${laws.length} laws, ${dropped} point(s) dropped for a number not in the text`);
