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
const u = await call("ask", { text: "新しい現場の朝礼は何時からですか？", askerRole: "young" }, young);
check("ungrounded question detected", !u.grounded);
const { questionId } = await call("sendToBox", { text: "新しい現場の朝礼は何時からですか？", askerName: "テスト若手", askerRole: "young" }, young);
const t2 = [{ role: "veteran", text: "（テスト用の文）新しい現場の朝礼は、だいたい8時から。前の日に職長に確認しておく。" }];
const d2 = await call("draftCard", { transcript: t2, authorName: "溝上（親方）", triggerQuestionId: questionId }, vet);
await call("publishCard", { cardId: d2.cardId, authorName: "溝上（親方）", showAuthorName: false, edits: { ...d2.draft, tags: ["朝礼", "集合時間", "新規入場"] } }, vet);
if (u.mode === "claude") for (const s of u.sentences) console.log(`     [${s.source}] ${s.text}`);
const q = await (await fetch(`${FS}/questions/${questionId}`)).json();
check("question marked answered", q.fields?.status?.stringValue === "answered");
const a2 = await call("ask", { text: "新しい現場の朝礼は何時からですか？", askerRole: "young" }, young);
check("same question now answered from the new card", a2.grounded && a2.cards.some((c) => c.id === d2.cardId && c.author === "社内のベテラン" && c.triggerAskerName === "テスト若手"));

// 5. Veteran's own view.
await call("markGoodQuestion", { questionId }, vet);
const mine = await call("myCards", {}, vet);
const pf = mine.cards.find((c) => c.id === d.cardId);
check("helped count reached the veteran", pf?.helpedCount === 1, `cards=${mine.cards.length}`);
check("clients cannot write directly", (await fetch(`${FS}/cards?documentId=x`, { method: "POST", body: JSON.stringify({ fields: { title: { stringValue: "x" } } }) })).status === 403);

// 6. Saved answers: the same question again does not call Claude (with an API key only).
if (a2.mode === "claude") {
  const a3 = await call("ask", { text: "新しい現場の朝礼は何時からですか", askerRole: "young" }, young);
  check("same question served from the saved answer", a3.cached === true && a3.answerId !== a2.answerId && a3.cards.some((c) => c.id === d2.cardId));
}

// 7. 審査員モード: a judge goes round the loop, and nobody else sees it.
const judge = await signUp(), other = await signUp();
const jq = await call("sendToBox", { text: "審査員の試しの質問です", askerName: "審査員", askerRole: "young", trial: true }, judge);
const jqDoc = await (await fetch(`${FS}/questions/${jq.questionId}`)).json();
check("judge's question stays in their own space", jqDoc.fields?.companyId?.stringValue?.startsWith("trial_"));
const jt = [{ role: "veteran", text: "審査員の試しの答え。脚立は開き止めを必ず掛けてから乗る。" }];
const jd = await call("draftCard", { transcript: jt, authorName: "審査員", trial: true }, judge);
await call("publishCard", { cardId: jd.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd.draft, tags: ["脚立", "開き止め"] }, trial: true }, judge);
const jMine = await call("myCards", { trial: true }, judge);
check("judge sees their trial card", jMine.cards.some((c) => c.id === jd.cardId));
const ja = await call("ask", { text: "脚立の開き止めは？", askerRole: "young", trial: true }, judge);
const oa = await call("ask", { text: "脚立の開き止めは？", askerRole: "young" }, other);
check("judge's answer uses their trial card, others' does not", ja.cards.some((c) => c.id === jd.cardId) && !oa.cards.some((c) => c.id === jd.cardId));
// answering a shared question from trial mode leaves it open for everyone else
const sq = await call("sendToBox", { text: "共有の質問箱の質問です", askerName: "若手", askerRole: "young" }, young);
const jd2 = await call("draftCard", { transcript: jt, authorName: "審査員", triggerQuestionId: sq.questionId, trial: true }, judge);
await call("publishCard", { cardId: jd2.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd2.draft, tags: ["脚立"] }, trial: true }, judge);
const sqDoc = await (await fetch(`${FS}/questions/${sq.questionId}`)).json();
check("trial card does not close a shared question", sqDoc.fields?.status?.stringValue === "open");

// 8. Shared writes have a daily cap per device.
const spammer = await signUp();
let blocked = false;
for (let i = 0; i < 21 && !blocked; i++) {
  try { await call("sendToBox", { text: `連投の試し ${i}`, askerRole: "young", trial: true }, spammer); }
  catch (e) { blocked = /resource-exhausted|RESOURCE_EXHAUSTED/.test(String(e)) && i === 20; }
}
check("21st question in a day is refused", blocked);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
