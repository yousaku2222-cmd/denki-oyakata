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
const d = await call("draftCard", { transcript: t, authorName: "山田（親方）" }, vet);
check("draft card created", !!d.cardId, d.draft.title);
check("draft is hidden from clients", (await clientGet(`cards/${d.cardId}`)) === 403);
await call("publishCard", { cardId: d.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...d.draft, tags: ["PF", "合成樹脂可とう電線管", "曲げ"] } }, vet);
check("published card is readable", (await fetch(`${FS}/cards/${d.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).status === 200);

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
const d2 = await call("draftCard", { transcript: t2, authorName: "山田（親方）", triggerQuestionId: questionId }, vet);
await call("publishCard", { cardId: d2.cardId, authorName: "山田（親方）", showAuthorName: false, edits: { ...d2.draft, tags: ["朝礼", "集合時間", "新規入場"] } }, vet);
if (u.mode === "claude") for (const s of u.sentences) console.log(`     [${s.source}] ${s.text}`);
const mineQ = (await call("myQuestions", {}, young)).questions.find((x) => x.id === questionId);
check("question marked answered", mineQ?.status === "answered" && !!mineQ.answeredCardTitle, mineQ?.answeredCardTitle);
// The veteran chose not to show the name: the public card must not carry it (nor the raw interview).
const hidden = await (await fetch(`${FS}/cards/${d2.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).json();
check("no device id on the public card", !hidden.fields?.authorId && !JSON.stringify(hidden.fields?.confirmations ?? {}).includes('"by"'));
check("hidden name is not in the public card", hidden.fields?.authorName?.stringValue === "" && !JSON.stringify(hidden).includes("山田"), hidden.fields?.authorName?.stringValue);
check("raw interview is not in the public card", !(hidden.fields?.transcript?.arrayValue?.values ?? []).length);
check("cards need a signed-in device; questions are not readable at all", (await clientGet(`cards/${d.cardId}`)) === 403 && (await fetch(`${FS}/questions/${questionId}`, { headers: { Authorization: `Bearer ${young}` } })).status === 403);
const box = await call("openQuestions", {}, vet);
check("question box lists without photos or device ids", Array.isArray(box.questions) && !JSON.stringify(box).includes("askerId") && !JSON.stringify(box).includes("data:image"));
const a2 = await call("ask", { text: "新しい現場の朝礼は何時からですか？", askerRole: "young" }, young);
check("same question now answered from the new card", a2.grounded && a2.cards.some((c) => c.id === d2.cardId && c.author === "社内のベテラン" && c.triggerAskerName === "テスト若手"));
// Saved answers: the same question again does not call Claude (with an API key only).
if (a2.mode === "claude") {
  const a3 = await call("ask", { text: "新しい現場の朝礼は何時からですか", askerRole: "young" }, young);
  check("same question served from the saved answer", a3.cached === true && a3.answerId !== a2.answerId && a3.cards.some((c) => c.id === d2.cardId));
}


// 5. Veteran's own view.
await call("markGoodQuestion", { questionId }, vet);
try { await call("markGoodQuestion", { questionId }, young); check("no いい質問 on your own question", false); }
catch (e) { check("no いい質問 on your own question", /FAILED_PRECONDITION|failed-precondition/.test(String(e))); }
const mine = await call("myCards", {}, vet);
const pf = mine.cards.find((c) => c.id === d.cardId);
check("helped count reached the veteran", pf?.helpedCount === 1, `cards=${mine.cards.length}`);
check("clients cannot write directly", (await fetch(`${FS}/cards?documentId=x`, { method: "POST", body: JSON.stringify({ fields: { title: { stringValue: "x" } } }) })).status === 403);

// 5b. Editing a hidden card keeps it hidden.
await call("setCardStatus", { cardId: d.cardId, status: "private" }, vet);
await call("publishCard", { cardId: d.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...d.draft, title: "直した題名", tags: ["PF"] } }, vet);
check("editing a hidden card keeps it hidden", (await call("myCards", {}, vet)).cards.find((c) => c.id === d.cardId)?.status === "private");
await call("setCardStatus", { cardId: d.cardId, status: "published" }, vet);

// 6. A draft left behind can be opened again or removed; it never shows to others.
const left = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト用）下書きのまま置いておく話。" }], authorName: "山田（親方）" }, vet);
const opened = await call("myCard", { cardId: left.cardId }, vet);
check("a draft can be opened again", opened.status === "draft" && opened.authorName === "山田（親方）");
try { await call("myCard", { cardId: left.cardId }, young); check("someone else cannot open my draft", false); }
catch (e) { check("someone else cannot open my draft", /permission-denied|PERMISSION_DENIED/.test(String(e))); }
await call("deleteDraft", { cardId: left.cardId }, vet);
check("a draft can be removed", !(await call("myCards", {}, vet)).cards.some((c) => c.id === left.cardId));

// 7. Moving to a new phone: the code moves the cards over, once.
const { code } = await call("makeTransferCode", {}, vet);
const newPhone = await signUp();
const moved = await call("useTransferCode", { code: code.toLowerCase() }, newPhone);
check("transfer code moves the cards", moved.cards === 2 && (await call("myCards", {}, newPhone)).cards.length === 2, JSON.stringify(moved));
try { await call("useTransferCode", { code }, await signUp()); check("transfer code works once", false); }
catch (e) { check("transfer code works once", /NOT_FOUND|not-found/.test(String(e))); }
try { await call("setCardStatus", { cardId: d.cardId, status: "private" }, vet); check("old phone no longer owns the cards", false); }
catch (e) { check("old phone no longer owns the cards", /permission-denied|PERMISSION_DENIED/.test(String(e))); }

// 7b. A refused edit (too long) does not use up the day's publications.
const longVet = await signUp();
const ld = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト）" + "長い話。".repeat(450) }] }, longVet);
check("drafts are cut to what can be published", ld.draft.body.length <= 1500, `body=${ld.draft.body.length}`);
let refused = 0;
for (let i = 0; i < 12; i++) {
  try { await call("publishCard", { cardId: ld.cardId, edits: { ...ld.draft, body: "長".repeat(1501) } }, longVet); }
  catch (e) { if (/INVALID_ARGUMENT/.test(String(e))) refused++; }
}
await call("publishCard", { cardId: ld.cardId, edits: ld.draft }, longVet);
check("refused publishes do not use up the cap", refused === 12);

// 8. The question box has its own daily cap per device (it costs no Claude call, but every veteran downloads it).
const spammer = await signUp();
let accepted = 0;
for (let i = 0; i < 21; i++) {
  try { await call("sendToBox", { text: `テスト${i}` }, spammer); accepted++; } catch { break; }
}
check("question box: 20 posts a day per device", accepted === 20, `accepted=${accepted}`);

// 9. 審査員モード: a judge goes round the loop, and nobody else sees it.
const judge = await signUp(), other = await signUp();
const jq = await call("sendToBox", { text: "審査員の試しの質問です", askerName: "審査員", askerRole: "young", trial: true }, judge);
check("judge's question is only in their own box", (await call("openQuestions", { trial: true }, judge)).questions.some((q) => q.id === jq.questionId) && !(await call("openQuestions", {}, other)).questions.some((q) => q.id === jq.questionId));
const jt = [{ role: "veteran", text: "（テスト用）脚立は開き止めを必ず掛けてから乗る。" }];
const jd = await call("draftCard", { transcript: jt, authorName: "審査員", trial: true }, judge);
await call("publishCard", { cardId: jd.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd.draft, tags: ["脚立", "開き止め"] }, trial: true }, judge);
check("judge sees their trial card", (await call("myCards", { trial: true }, judge)).cards.some((c) => c.id === jd.cardId));
// the same holds for a device reading Firestore directly (the rules, not only the server)
const otherToken = other;
check("another device cannot read a judge's trial card", (await fetch(`${FS}/cards/${jd.cardId}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status === 403);
check("the judge can read their own trial card", (await fetch(`${FS}/cards/${jd.cardId}`, { headers: { Authorization: `Bearer ${judge}` } })).status === 200);
const ja = await call("ask", { text: "脚立の開き止めは？", askerRole: "young", trial: true }, judge);
const oa = await call("ask", { text: "脚立の開き止めは？", askerRole: "young" }, other);
check("judge's answer uses their trial card, others' does not", ja.cards.some((c) => c.id === jd.cardId) && !oa.cards.some((c) => c.id === jd.cardId));
// answering a shared question from trial mode leaves it open for everyone else
const sq = await call("sendToBox", { text: "共有の質問箱の質問です", askerName: "若手", askerRole: "young" }, other);
const jd2 = await call("draftCard", { transcript: jt, authorName: "審査員", triggerQuestionId: sq.questionId, trial: true }, judge);
await call("publishCard", { cardId: jd2.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd2.draft, tags: ["脚立"] }, trial: true }, judge);
check("trial card does not close a shared question", (await call("myQuestions", {}, other)).questions.find((q) => q.id === sq.questionId)?.status === "open");

console.log("\n10. 同じ質問・いい質問");
const asker1 = await signUp(), asker2 = await signUp(), vet2 = await signUp();
const s1 = await call("sendToBox", { text: "ジョイントボックスの中の結線は何で留める？", askerName: "若手1", askerRole: "young" }, asker1);
const s1again = await call("sendToBox", { text: "ジョイントボックスの中の結線は何で留める", askerName: "若手1", askerRole: "young" }, asker1);
check("the same device sending the same question again adds nothing", s1again.duplicate === true && s1again.questionId === s1.questionId);
const s2 = await call("sendToBox", { text: "ジョイントボックスの 中の結線は何で留める？", askerName: "若手2", askerRole: "young" }, asker2);
check("another device's same question joins it", s2.merged === true && s2.questionId === s1.questionId && s2.askers === 2);
const inBox = (await call("openQuestions", {}, vet2)).questions.filter((q) => q.id === s1.questionId);
check("the box shows it once, asked by 2", inBox.length === 1 && inBox[0].askers === 2);
await call("markGoodQuestion", { questionId: s1.questionId }, vet2);
const seen2 = (await call("myQuestions", {}, asker2)).questions.find((q) => q.id === s1.questionId);
check("the one who joined sees it on わたし, with the いい質問", seen2?.askers === 2 && seen2?.good === 1);
const photoQ = await call("sendToBox", { text: "ジョイントボックスの中の結線は何で留める？", photo: "data:image/jpeg;base64,/9j/4AAQ", askerName: "若手1", askerRole: "young" }, asker1);
check("a photo question is never merged", !photoQ.duplicate && !photoQ.merged && photoQ.questionId !== s1.questionId);
const jd3 = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト用）ジョイントボックスの結線は差込形コネクタで留める。" }], authorName: "山田（親方）", triggerQuestionId: s1.questionId }, vet2);
await call("publishCard", { cardId: jd3.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...jd3.draft, tags: ["ジョイントボックス"] } }, vet2);
const done2 = (await call("myQuestions", {}, asker2)).questions.find((q) => q.id === s1.questionId);
check("when it is answered, the one who joined hears it too (with who answered)", done2?.status === "answered" && done2.answeredBy === "山田（親方）" && done2.answeredAt > 0);

console.log("\n11. 続きの質問");
const f1 = await call("sendToBox", { text: "コネクタは何本用を選ぶ？", askerName: "若手2", askerRole: "young", followUpOf: s1.questionId }, asker2);
const fBox = (await call("openQuestions", {}, vet2)).questions.find((q) => q.id === f1.questionId);
check("a follow-up shows the earlier question and its card in the box", fBox?.followUp?.text === "ジョイントボックスの中の結線は何で留める？" && !!fBox.followUp.cardTitle && !("questionId" in fBox.followUp));
const f2 = await call("sendToBox", { text: "コネクタは何本用を選ぶ？", askerName: "若手1", askerRole: "young", followUpOf: s1.questionId }, asker1);
check("a follow-up is never merged", !f2.merged && !f2.duplicate && f2.questionId !== f1.questionId);
const stranger = await signUp();
let strangerRefused = false;
try {
  await call("sendToBox", { text: "コネクタは何本用を選ぶ？", askerName: "他人", askerRole: "young", followUpOf: s1.questionId }, stranger);
} catch {
  strangerRefused = true;
}
check("only the one who asked can follow a question up", strangerRefused);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
