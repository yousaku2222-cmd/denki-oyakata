// End-to-end check against the local emulators (dummy mode or real Claude).
// Usage: node scripts/e2e.mjs   (emulators must be running)
const BASE = "http://127.0.0.1:5001/demo-denki-oyakata/asia-northeast1";
const FS = "http://127.0.0.1:8080/v1/projects/demo-denki-oyakata/databases/(default)/documents";
let failed = 0;

// Anonymous users from the auth emulator; the server takes the uid from the token only.
async function signUp() {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return (await r.json()).idToken;
}
const vet = await signUp(), young = await signUp();

async function call(name, data, token) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(`${BASE}/${name}`, { method: "POST", headers, body: JSON.stringify({ data }) });
  const j = await r.json();
  if (j.error) throw new Error(`${name}: ${JSON.stringify(j.error)}`);
  return j.result;
}
function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "NG  "} ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}
const clientGet = (path) => fetch(`${FS}/${path}`).then((r) => r.status);

// Start from an empty local database so earlier runs cannot answer for this one.
await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-denki-oyakata/databases/(default)/documents", { method: "DELETE" });

try { await call("myCards", {}); check("unauthenticated call rejected", false); }
catch (e) { check("unauthenticated call rejected", /UNAUTHENTICATED/.test(String(e))); }

// 1. Veteran talks, AI asks back, card is drafted.
let t = [{ role: "veteran", text: "PF管はな、床の埋設配管で90度の曲がりが3か所あったら線が通らん。プルボックスを入れる。" }];
let n = await call("interviewNext", { transcript: t }, vet);
check("interview asks a follow-up", !n.done && n.question.length > 0, `[${n.mode}] ${n.question}`);
t = [...t, { role: "ai", text: n.question }, { role: "veteran", text: "曲げすぎると摩擦で通線できんようになるけん。" }];
const d = await call("draftCard", { transcript: t, authorName: "溝上（親方）" }, vet);
check("draft card created", !!d.cardId, d.draft.title);
check("draft is hidden from clients", (await clientGet(`cards/${d.cardId}`)) === 403);
await call("publishCard", { cardId: d.cardId, authorName: "溝上（親方）", showAuthorName: true, edits: { ...d.draft, tags: ["PF", "合成樹脂可とう電線管", "曲げ"] } }, vet);
check("published card is readable", (await clientGet(`cards/${d.cardId}`)) === 200);

// 2. Someone else cannot publish or hide it.
try { await call("setCardStatus", { cardId: d.cardId, status: "private" }, young); check("other device blocked", false); }
catch (e) { check("other device blocked", /permission-denied|PERMISSION_DENIED/.test(String(e))); }

// 3. Young asks: answer cites the card in green.
const a = await call("ask", { text: "PF管って何回まで曲げていいですか？", askerRole: "young" }, young);
check("answer grounded in the card", a.grounded && a.sentences.some((s) => s.source === "wisdom" && s.cardId === d.cardId), `[${a.mode}] ${a.sentences.length} sentences`);
if (a.mode === "claude") for (const s of a.sentences) console.log(`     [${s.source}] ${s.text}`);
await call("markHelped", { answerId: a.answerId }, young);

// 4. Unknown question goes to the box; veteran answers it; young sees it answered.
const u = await call("ask", { text: "資格が無くても出来る作業はありますか？", askerRole: "young" }, young);
check("ungrounded question detected", !u.grounded);
const { questionId } = await call("sendToBox", { text: "資格が無くても出来る作業はありますか？", askerName: "テスト若手", askerRole: "young" }, young);
const t2 = [{ role: "veteran", text: "（テスト用の文）資格が無い間は、材料運びや養生、片付けを手伝ってもらう。" }];
const d2 = await call("draftCard", { transcript: t2, authorName: "溝上（親方）", triggerQuestionId: questionId }, vet);
await call("publishCard", { cardId: d2.cardId, authorName: "溝上（親方）", showAuthorName: false, edits: { ...d2.draft, tags: ["無資格", "資格なし", "見習い"] } }, vet);
if (u.mode === "claude") for (const s of u.sentences) console.log(`     [${s.source}] ${s.text}`);
const q = await (await fetch(`${FS}/questions/${questionId}`)).json();
check("question marked answered", q.fields?.status?.stringValue === "answered");
const a2 = await call("ask", { text: "資格が無くても出来る作業はありますか？", askerRole: "young" }, young);
check("same question now answered from the new card", a2.grounded && a2.cards.some((c) => c.id === d2.cardId && c.author === "社内のベテラン" && c.triggerAskerName === "テスト若手"));

// 5. Veteran's own view.
await call("markGoodQuestion", { questionId }, vet);
const mine = await call("myCards", {}, vet);
const pf = mine.cards.find((c) => c.id === d.cardId);
check("helped count reached the veteran", pf?.helpedCount === 1, `cards=${mine.cards.length}`);
check("clients cannot write directly", (await fetch(`${FS}/cards?documentId=x`, { method: "POST", body: JSON.stringify({ fields: { title: { stringValue: "x" } } }) })).status === 403);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
