// 正答率テスト: the same 20 questions to (A) the deployed app and (B) the same model with no cards and no law texts,
// then Opus grades both answers against the expected points without knowing which is which.
// Usage (from the repo root, needs functions/.secret.local and a build of functions/):
//   node scripts/accuracy.mjs            # all questions
//   node scripts/accuracy.mjs 3 15       # only these ids
//   node scripts/accuracy.mjs --holdout  # the 10 check questions, never looked at while tuning the prompts
//   Run right after deploying functions: a saved answer (same question, same revision) stops the run.
// Writes docs/accuracy.md and scripts/accuracy/result.json. Costs about ¥300 a run (60 Claude calls).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const Anthropic = require("@anthropic-ai/sdk").default;
const { MODEL_ANSWER, MODEL_HEAVY } = require("./lib/models.js");

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const apiKey = read("functions/.secret.local").match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1].trim();
if (!apiKey) throw new Error("functions/.secret.local has no ANTHROPIC_API_KEY");
const claude = new Anthropic({ apiKey });
const webKey = read("web/.env.production").match(/^VITE_FIREBASE_API_KEY=(.+)$/m)[1].trim();
const laws = JSON.parse(read("functions/data/laws.json"));
const lawList = Array.isArray(laws) ? laws : laws.laws;
const lawById = new Map(lawList.map((l) => [l.id, l]));

const holdout = process.argv.includes("--holdout");
const suffix = holdout ? "_holdout" : "";
const only = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number);
const questions = JSON.parse(read(`scripts/accuracy/${holdout ? "holdout" : "questions"}.json`)).filter((q) => !only.length || only.includes(q.id));

// --- A: the app, as a judge would use it (a fresh anonymous device) ---
const signUp = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${webKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
async function askApp(text) {
  const r = await (await fetch("https://asia-northeast1-denki-oyakata.cloudfunctions.net/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signUp.idToken}` }, body: JSON.stringify({ data: { text, askerRole: "young" } }) })).json();
  if (r.error) throw new Error(`ask: ${JSON.stringify(r.error)}`);
  // a saved answer would only grade the last run's answers again: measure right after a deploy (the cache key changes)
  if (r.result.cached && !process.argv.includes("--allow-cached")) throw new Error(`保存した答えが返りました（${text}）。functions をデプロイした直後に測ってください。採点だけやり直すなら --allow-cached`);
  return r.result;
}
/**
 * The app's answer as plain sentences, for the grader: no source labels (⚖️・🧰・「引用は原文と一致」), which would
 * tell the grader which answer is the app's and nudge it. A law sentence keeps the article it cites, the way a
 * plain answer names one.
 */
function appText(a) {
  const law = new Map(a.laws.map((l) => [l.id, l]));
  const lines = a.sentences.map((s) => {
    const l = s.source === "law" ? law.get(s.lawId) : undefined;
    return l ? `${s.text}（${l.lawName} ${l.article}）` : s.text;
  });
  for (const c of a.calcs ?? []) lines.push(`${c.title}: ${c.verdict}`);
  if (a.safetyNote) lines.push(a.safetyNote);
  return lines.join("\n");
}
/** The plain answer without markdown marks, which would also tell the two apart. */
const unmark = (md) =>
  md
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*]\s+/gm, "・")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\|/g, " ");
/** The articles a plain answer names (the law's name or usual short name, and the article), among the 52. */
function citedIn(text) {
  const t = text.replace(/\s/g, "");
  const names = (l) => [l.lawName, l.short, l.id.startsWith("kaishaku-") ? "解釈" : "", l.id.startsWith("shiyo-") ? "標準仕様書" : ""].filter(Boolean);
  return lawList
    .filter((l) => new RegExp(`${l.article.replace(/\./g, "[.．]")}(?![0-9の.．])`).test(t) && names(l).some((n) => t.includes(n)))
    .map((l) => l.id);
}

/** The app's answer as the young worker sees it, for the report: each sentence with its source. */
function appView(a) {
  const card = new Map(a.cards.map((c) => [c.id, c]));
  const law = new Map(a.laws.map((l) => [l.id, l]));
  const lines = a.sentences.map((s) => {
    if (s.source === "law") {
      const l = law.get(s.lawId);
      return `[⚖️法令・基準 ${l ? `${l.short ?? l.lawName} ${l.article}` : ""}${s.verified ? "・引用は原文と一致" : ""}${s.quote ? `「${s.quote}」` : ""}] ${s.text}`;
    }
    if (s.source === "wisdom") return `[🧰親方の知恵「${card.get(s.cardId)?.title ?? ""}」] ${s.text}`;
    return `[💡一般知識（要確認）] ${s.text}`;
  });
  for (const c of a.calcs ?? []) lines.push(`[🧮計算 ${c.title}] ${c.verdict}`);
  if (a.safetyNote) lines.push(`[注意] ${a.safetyNote}`);
  return lines.join("\n");
}

// --- B: the same model on its own ---
const PLAIN_SYSTEM = "電気工事の若手（資格なし〜第二種電気工事士）からの質問に、日本語で答えてください。根拠になる法令・基準があれば、法令名と条番号も示してください。";
async function askPlain(text) {
  // max_tokens also covers thinking: at 3000 the thinking alone used it up and 4 of the 20 answers came back empty
  const res = await claude.messages.create({ model: MODEL_ANSWER, max_tokens: 16000, system: PLAIN_SYSTEM, messages: [{ role: "user", content: text }] });
  const out = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (res.stop_reason === "max_tokens" || !out.trim()) throw new Error(`plain answer cut off (${res.stop_reason}, ${res.usage.output_tokens} tokens)`);
  return out;
}

// --- grading: blind, both answers in one request so the same yardstick is used ---
const GRADE_SYSTEM = `あなたは電気工事の教育担当です。若手の質問に対する2つの答え（X・Y）を、示した「正解の要点」と「根拠の条文」に照らして採点します。どちらがどの仕組みの答えかは知らされません。
- correct: ○=要点を満たし誤りがない／△=一部だけ・あいまい・余計な誤りが少しある／×=要点を外している・誤っている
- basis: 答えが挙げた法令・条番号・数値の根拠について。ok=挙げた根拠が実在し、内容と合っている／wrong=条番号の誤り・条文に無い内容・作り話の根拠がある／none=法令の根拠を挙げていない（法令の根拠が要らない質問なら none で減点しない）
- dangerous: 資格・感電・安全に関わる誤りで、若手がそのまま従うと危ないものがあれば true
- reason: 判断の理由を80字以内。根拠の誤りがあれば、どこが誤りかを書く
条文の原文を渡すので、根拠の正しさはそれで確かめること。原文に無い条文については、あなたの知識で判断し、自信が無ければそう書く。`;
const GRADE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    ["x", "y"].map((k) => [
      k,
      {
        type: "object",
        properties: { correct: { type: "string", enum: ["○", "△", "×"] }, basis: { type: "string", enum: ["ok", "wrong", "none"] }, dangerous: { type: "boolean" }, reason: { type: "string" } },
        required: ["correct", "basis", "dangerous", "reason"],
        additionalProperties: false,
      },
    ]),
  ),
  required: ["x", "y"],
  additionalProperties: false,
};
async function grade(q, app, plain, citedLawIds = []) {
  const appFirst = q.id % 2 === 1; // which answer is X alternates by question
  const [x, y] = appFirst ? [app, unmark(plain)] : [unmark(plain), app];
  // the articles the question is about, plus every article either answer cited (both are checked against the text)
  const lawText = [...new Set([...q.lawIds, ...citedLawIds])].map((id) => lawById.get(id)).filter(Boolean).map((l) => `【${l.short ?? l.lawName} ${l.article}】\n${l.text}`).join("\n\n") || "（この質問に法令の根拠は要らない想定）";
  const res = await claude.messages.create({
    model: MODEL_HEAVY,
    max_tokens: 8000,
    system: GRADE_SYSTEM,
    messages: [{ role: "user", content: `質問: ${q.q}\n\n正解の要点: ${q.points}\n\n根拠の条文の原文:\n${lawText}\n\n答えX:\n${x}\n\n答えY:\n${y}` }],
    output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
  });
  const g = JSON.parse(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  return appFirst ? { app: g.x, plain: g.y } : { app: g.y, plain: g.x };
}

// --- run (4 at a time) ---
const results = [];
for (let i = 0; i < questions.length; i += 4) {
  results.push(
    ...(await Promise.all(
      questions.slice(i, i + 4).map(async (q) => {
        const [a, plain] = await Promise.all([askApp(q.q), askPlain(q.q)]);
        const g = await grade(q, appText(a), plain, [...a.laws.map((l) => l.id), ...citedIn(plain)]);
        const app = appView(a);
        console.log(`#${q.id} app ${g.app.correct}/${g.app.basis}  plain ${g.plain.correct}/${g.plain.basis}`);
        return { ...q, app, plain, cached: a.cached, grade: g };
      }),
    )),
  );
}
results.sort((a, b) => a.id - b.id);
writeFileSync(new URL(`scripts/accuracy/result${suffix}.json`, root), JSON.stringify(results, null, 2));

// --- report ---
const score = { "○": 1, "△": 0.5, "×": 0 };
const pct = (n) => `${Math.round((n / results.length) * 100)}%`;
function sum(side) {
  const g = results.map((r) => r.grade[side]);
  const cited = g.filter((x) => x.basis !== "none");
  return {
    correct: pct(g.reduce((t, x) => t + score[x.correct], 0)),
    full: g.filter((x) => x.correct === "○").length,
    basisWrong: g.filter((x) => x.basis === "wrong").length,
    cited: cited.length,
    dangerous: g.filter((x) => x.dangerous).length,
  };
}
const A = sum("app"), B = sum("plain");
const md = [
  holdout ? "# 正答率テスト（確認用の10問）" : "# 正答率テスト",
  "",
  `${holdout ? `答えの指示を直す時に見ていない確認用の ${results.length} 問（若手がよく聞くことと法令）を、` : `若手の本物の質問（記入シート）とベテランの失敗談・法令から ${results.length} 問を、`}でんきの親方と、同じモデル（${MODEL_ANSWER}）に知恵カードも条文も渡さずに聞いた答えで比べました。採点は ${MODEL_HEAVY} が、どちらの答えかを伏せて「正解の要点」と条文の原文に照らして行い、最後に人（ベテラン）が確かめます。問題と正解の要点は \`scripts/accuracy/${holdout ? "holdout" : "questions"}.json\`、実行は \`node scripts/accuracy.mjs${holdout ? " --holdout" : ""}\`。`,
  "",
  "| | でんきの親方 | 素の Claude |",
  "|---|---|---|",
  `| 正しさ（○=1, △=0.5） | **${A.correct}** | ${B.correct} |`,
  `| ○の数 | ${A.full} / ${results.length} | ${B.full} / ${results.length} |`,
  `| 根拠の誤り（条番号・条文に無い内容） | **${A.basisWrong}** 件（根拠を挙げた ${A.cited} 問のうち） | ${B.basisWrong} 件（根拠を挙げた ${B.cited} 問のうち） |`,
  `| 危ない誤り（資格・感電・安全） | ${A.dangerous} 件 | ${B.dangerous} 件 |`,
  "",
  "## 1問ずつ",
  "",
  ...results.flatMap((r) => [
    `### ${r.id}. ${r.q}`,
    "",
    `出典: ${r.from}　正解の要点: ${r.points}`,
    "",
    `**でんきの親方** — ${r.grade.app.correct}・根拠 ${r.grade.app.basis}${r.grade.app.dangerous ? "・⚠️危ない誤り" : ""}${r.cached ? "（保存した答え）" : ""}：${r.grade.app.reason}`,
    "",
    "```",
    r.app,
    "```",
    "",
    `**素の Claude** — ${r.grade.plain.correct}・根拠 ${r.grade.plain.basis}${r.grade.plain.dangerous ? "・⚠️危ない誤り" : ""}：${r.grade.plain.reason}`,
    "",
    "<details><summary>答えの全文</summary>",
    "",
    r.plain,
    "",
    "</details>",
    "",
  ]),
].join("\n");
writeFileSync(new URL(`docs/accuracy${suffix}.md`, root), md);
console.log(`\nでんきの親方 ${A.correct}（根拠の誤り ${A.basisWrong}）／素の Claude ${B.correct}（根拠の誤り ${B.basisWrong}）→ docs/accuracy${suffix}.md`);
