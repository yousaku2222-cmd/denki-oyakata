// Ask the local emulator a question and print the colored answer. Usage: node scripts/ask.mjs "質問" ["質問" ...]
const BASE = "http://127.0.0.1:5001/demo-denki-oyakata/asia-northeast1";
const signUp = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const { idToken } = await signUp.json();
const mark = { law: "⚖️青", wisdom: "🧰緑", general: "💡灰" };
for (const text of process.argv.slice(2)) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/ask`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ data: { text, askerRole: "young" } }) });
  const j = await r.json();
  if (j.error) { console.log(text, "→", j.error); continue; }
  const a = j.result;
  console.log(`\n■ ${text}  (${((Date.now() - t0) / 1000).toFixed(1)}秒, ${a.mode})\n  こう受け取りました: ${a.interpretedAs}`);
  for (const c of a.calcs ?? []) {
    console.log(`  🧮 ${c.title}: ${c.verdict}`);
    for (const s of c.steps) console.log(`     ${s}`);
    for (const b of c.basisShown) console.log(`     ⚖️「${b.quote}」${b.label} ✔`);
  }
  for (const s of a.sentences) {
    const law = a.laws.find((l) => l.id === s.lawId);
    console.log(`  ${mark[s.source]} ${s.text}${s.verified ? "  ✔原文と一致" : ""}`);
    if (law) console.log(`       「${s.quote}」 ${law.short} ${law.article}【${law.heading}】`);
  }
}
