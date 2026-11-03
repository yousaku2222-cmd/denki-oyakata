// Send part photos to the local emulator's identifyPart and print what came back.
// Usage: node scripts/photo.mjs <photo.jpg> [...]   (the file name is shown next to the answer, so name files by what they are)
import { createRequire } from "node:module";
import { basename } from "node:path";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const sharp = require("sharp");

const BASE = "http://127.0.0.1:5001/demo-denki-oyakata/asia-northeast1";
const signUp = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const { idToken } = await signUp.json();
const say = { sure: "✅ ほぼ間違いない", likely: "🤔 たぶんこれ", unknown: "❓ 分からない" };

for (const file of process.argv.slice(2)) {
  // the same shrinking the web app does before sending
  const image = (await sharp(file).rotate().resize({ width: 1600, height: 1600, fit: "inside" }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
  const t0 = Date.now();
  const r = await fetch(`${BASE}/identifyPart`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ data: { image } }) });
  const j = await r.json();
  if (j.error) {
    console.log(`\n■ ${basename(file)} → ${JSON.stringify(j.error)}`);
    continue;
  }
  const a = j.result;
  console.log(`\n■ ${basename(file)}  (${((Date.now() - t0) / 1000).toFixed(1)}秒${a.zoomed ? `・拡大${a.zoomed}か所` : ""})`);
  console.log(`  ${say[a.verdict]}: ${a.name || "—"}  呼び名: ${a.fieldNames.join("・")}  読み取り: ${a.printed || "—"}`);
  console.log(`  用途: ${a.use}`);
  if (a.candidates.length) console.log(`  候補: ${a.candidates.map((c) => `${c.name}（${c.hint}）`).join(" / ")}`);
  if (a.calc) console.log(`  🧮 ${a.calc.label} ${JSON.stringify(a.calc.params)}`);
  if (a.cards.length) console.log(`  🧰 ${a.cards.map((c) => c.title).join(" / ")}`);
  if (a.laws.length) console.log(`  ⚖️ ${a.laws.map((l) => l.label).join(" / ")}`);
  if (a.confusables.length) console.log(`  ⚠️ ${a.confusables.map((c) => `${c.name}: ${c.diff}`).join(" / ")}`);
  if (a.companions.length) console.log(`  🔩 ${a.companions.join("・")}`);
}
