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
// a card goes out only once it is checked against the articles as it is (publishCard refuses others): as the edit screen does
async function publish(data, token) {
  await call("checkCard", { cardId: data.cardId, edits: data.edits }, token);
  return call("publishCard", data, token);
}

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
// a meaning sent for a word that is not on the card is dropped (the screens underline only words on it)
const forged = { word: "カードに無い言葉", meaning: "x" };
await publish({ cardId: d.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...d.draft, tags: ["PF", "合成樹脂可とう電線管", "曲げ"], terms: [...d.draft.terms, forged] } }, vet);
check("published card is readable", (await fetch(`${FS}/cards/${d.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).status === 200);
const kept = (await call("myCard", { cardId: d.cardId }, vet)).draft;
check("the veteran's words keep their meanings, only words on the card", JSON.stringify(kept.terms) === JSON.stringify(d.draft.terms) && kept.plain === d.draft.plain, JSON.stringify(kept.terms));

// 2. Someone else cannot publish or hide it.
try { await call("setCardStatus", { cardId: d.cardId, status: "private" }, young); check("other device blocked", false); }
catch (e) { check("other device blocked", /permission-denied|PERMISSION_DENIED/.test(String(e))); }

// 3. Young asks: answer cites the card in green.
const a = await call("ask", { text: "PF管って何回まで曲げていいですか？", askerRole: "young" }, young);
check("answer grounded in the card", a.grounded && a.sentences.some((s) => s.source === "wisdom" && s.cardId === d.cardId), `[${a.mode}] ${a.sentences.length} sentences`);
if (a.mode === "claude") for (const s of a.sentences) console.log(`     [${s.source}] ${s.text}`);
await call("markHelped", { answerId: a.answerId }, young);

// 3b. The mark of a card let out by the check (lawCheckVer): a published card without it (from before the check, or
// written some other way) reaches young workers nowhere. Written here as the admin would, without going through publishCard.
const card = (doc) => doc.fields;
const asAdmin = { "Content-Type": "application/json", Authorization: "Bearer owner" };
const sv = (v) => ({ stringValue: v });
const UNMARKED = "（テスト）足場板の結束は、番線を必ず3回まわして締める。";
const unmarkedId = "e2e-unmarked-card";
await fetch(`${FS}/cards?documentId=${unmarkedId}`, {
  method: "POST",
  headers: asAdmin,
  body: JSON.stringify({ fields: { companyId: sv("demo"), status: sv("published"), title: sv("（テスト）足場板の結束"), scene: sv(""), body: sv(UNMARKED), reason: sv(""), caution: sv(""), tags: { arrayValue: { values: [sv("足場板"), sv("番線"), sv("結束")] } }, authorName: sv(""), showAuthorName: { booleanValue: false }, helpedCount: { integerValue: "0" }, viewCount: { integerValue: "0" }, publishedAt: { timestampValue: new Date().toISOString() } } }),
});
check("a published card without the mark is not readable by young workers", (await fetch(`${FS}/cards/${unmarkedId}`, { headers: { Authorization: `Bearer ${young}` } })).status === 403);
check("the marked card is readable", card(await (await fetch(`${FS}/cards/${d.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).json())?.lawCheckVer?.integerValue === "1");
// 探す reads the cards with a query: it must ask for the mark (firestore.rules refuses a query that could return others)
const listQuery = (withMark) => fetch(`${FS}:runQuery`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${young}` },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "cards" }], where: { compositeFilter: { op: "AND", filters: [
    { fieldFilter: { field: { fieldPath: "companyId" }, op: "IN", value: { arrayValue: { values: [sv("demo")] } } } },
    { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: sv("published") } },
    ...(withMark ? [{ fieldFilter: { field: { fieldPath: "lawCheckVer" }, op: "EQUAL", value: { integerValue: "1" } } }] : []),
  ] } } } }),
});
const listed = await listQuery(true);
const listedIds = listed.ok ? (await listed.json()).filter((x) => x.document).map((x) => x.document.name.split("/").pop()) : [];
check("探す's query lists marked cards only", listed.ok && listedIds.includes(d.cardId) && !listedIds.includes(unmarkedId), `${listed.status} ${listedIds.length} card(s)`);
check("a query that does not ask for the mark is refused", (await listQuery(false)).status === 403);
const ua = await call("ask", { text: "足場板の結束は番線を何回まわす？", askerRole: "young" }, young);
check("a card without the mark is used by no answer", !ua.cards.some((c) => c.id === unmarkedId) && !ua.sentences.some((x) => x.cardId === unmarkedId), `[${ua.mode}] cards: ${ua.cards.map((c) => c.id).join(",") || "none"}`);

// 3c. The standard-Japanese wording is checked too: rewritten after the check, publishing is refused
let plainChanged = "";
try { await call("publishCard", { cardId: d.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...kept, plain: "（テスト）PF管は何回曲げてもかまいません。" } }, vet); } catch (e) { plainChanged = String(e); }
check("only the standard-Japanese wording rewritten after the check: refused", /FAILED_PRECONDITION/.test(plainChanged) && plainChanged.includes("照らし合わせ"), plainChanged.slice(0, 120));
const dNow = card(await (await fetch(`${FS}/cards/${d.cardId}`, { headers: asAdmin })).json());
check("the refused wording is not on the card", !JSON.stringify(dNow).includes("何回曲げてもかまいません"));

// 4. Unknown question goes to the box; veteran answers it; young sees it answered.
const u = await call("ask", { text: "新しい現場の朝礼は何時からですか？", askerRole: "young" }, young);
check("ungrounded question detected", !u.grounded);
const { questionId } = await call("sendToBox", { text: "新しい現場の朝礼は何時からですか？", askerName: "テスト若手", askerRole: "young" }, young);
const t2 = [{ role: "veteran", text: "（テスト用の文）新しい現場の朝礼は、だいたい8時から。前の日に職長に確認しておく。" }];
const d2 = await call("draftCard", { transcript: t2, authorName: "山田（親方）", triggerQuestionId: questionId }, vet);
await publish({ cardId: d2.cardId, authorName: "山田（親方）", showAuthorName: false, edits: { ...d2.draft, tags: ["朝礼", "集合時間", "新規入場"] } }, vet);
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
await publish({ cardId: d.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...d.draft, title: "直した題名", tags: ["PF"] } }, vet);
check("editing a hidden card keeps it hidden", (await call("myCards", {}, vet)).cards.find((c) => c.id === d.cardId)?.status === "private");
await call("setCardStatus", { cardId: d.cardId, status: "published" }, vet);

// 6. A draft left behind can be opened again or removed; it never shows to others.
const left = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト用）下書きのまま置いておく話。" }], authorName: "山田（親方）" }, vet);
const opened = await call("myCard", { cardId: left.cardId }, vet);
check("a draft can be opened again", opened.status === "draft" && opened.authorName === "山田（親方）");
check("the writer gets back what was told, to fix it by", opened.transcript?.[0]?.text === "（テスト用）下書きのまま置いておく話。");
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
// the talk says nothing, so Claude may rightly leave やり方 empty: the veteran would write one before publishing
// (only a short body here: a card of hundreds of 「長い話。」 is more than one check can read)
const ldEdits = { ...ld.draft, scene: "", body: "（テスト）長い話。", reason: "", caution: "" };
// not checked against the articles yet: refused, and that does not use up the day either
let unchecked = 0, uncheckedMsg = "";
for (let i = 0; i < 12; i++) {
  try { await call("publishCard", { cardId: ld.cardId, edits: ldEdits }, longVet); }
  catch (e) { if (/FAILED_PRECONDITION/.test(String(e))) { unchecked++; uncheckedMsg = String(e); } }
}
check("a card not checked against the articles cannot be published", unchecked === 12 && uncheckedMsg.includes("条文との照らし合わせをしてから公開してください"), uncheckedMsg.slice(0, 120));
await publish({ cardId: ld.cardId, edits: ldEdits }, longVet);
check("refused publishes do not use up the cap", refused === 12 && (await call("myCards", {}, longVet)).cards[0]?.status === "published");

// 8. The question box has its own daily cap per device (it costs no Claude call, but every veteran downloads it).
const spammer = await signUp();
let accepted = 0;
for (let i = 0; i < 21; i++) {
  try { await call("sendToBox", { text: `テスト${i}`, confirmed: true }, spammer); accepted++; } catch { break; }
}
check("question box: 20 posts a day per device", accepted === 20, `accepted=${accepted}`);

// 8b. Before the box (with real Claude only): words the veteran could not follow are held and shown back, not sent.
if (a.mode === "claude") {
  const unsure = await signUp();
  const muddled = "ブレーカー あの 上がらん 昨日の 線 どこ";
  const h = await call("sendToBox", { text: muddled, askerName: "若手", askerRole: "young" }, unsure);
  check("muddled words are held with a reason and a fixed wording", h.needsConfirm === true && !h.questionId && !!h.reason, `${h.reason} → ${h.suggestion}`);
  check("a held question is not in the box", !(await call("myQuestions", {}, unsure)).questions.length);
  const kept = await call("sendToBox", { text: muddled, askerName: "若手", askerRole: "young", confirmed: true }, unsure);
  check("「このまま送る」 sends it without asking again", !!kept.questionId && !kept.needsConfirm);
  const plain = await call("sendToBox", { text: "分電盤のブレーカーが上がらない時は、まず何を確かめればいいですか？", askerName: "若手", askerRole: "young" }, unsure);
  check("a clear question goes straight in", !!plain.questionId && !plain.needsConfirm, plain.reason ?? "");
}

// 9. 審査員モード: a judge goes round the loop, and nobody else sees it.
const judge = await signUp(), other = await signUp();
const jq = await call("sendToBox", { text: "審査員の試しの質問です", confirmed: true, askerName: "審査員", askerRole: "young", trial: true }, judge);
check("judge's question is only in their own box", (await call("openQuestions", { trial: true }, judge)).questions.some((q) => q.id === jq.questionId) && !(await call("openQuestions", {}, other)).questions.some((q) => q.id === jq.questionId));
const jt = [{ role: "veteran", text: "（テスト用）脚立は開き止めを必ず掛けてから乗る。" }];
const jd = await call("draftCard", { transcript: jt, authorName: "審査員", trial: true }, judge);
await publish({ cardId: jd.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd.draft, tags: ["脚立", "開き止め"] }, trial: true }, judge);
check("judge sees their trial card", (await call("myCards", { trial: true }, judge)).cards.some((c) => c.id === jd.cardId));
// the same holds for a device reading Firestore directly (the rules, not only the server)
const otherToken = other;
check("another device cannot read a judge's trial card", (await fetch(`${FS}/cards/${jd.cardId}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status === 403);
check("the judge can read their own trial card", (await fetch(`${FS}/cards/${jd.cardId}`, { headers: { Authorization: `Bearer ${judge}` } })).status === 200);
const ja = await call("ask", { text: "脚立の開き止めは？", askerRole: "young", trial: true }, judge);
const oa = await call("ask", { text: "脚立の開き止めは？", askerRole: "young" }, other);
check("judge's answer uses their trial card, others' does not", ja.cards.some((c) => c.id === jd.cardId) && !oa.cards.some((c) => c.id === jd.cardId));
// answering a shared question from trial mode leaves it open for everyone else
const sq = await call("sendToBox", { text: "共有の質問箱の質問です", confirmed: true, askerName: "若手", askerRole: "young" }, other);
const jd2 = await call("draftCard", { transcript: jt, authorName: "審査員", triggerQuestionId: sq.questionId, trial: true }, judge);
await publish({ cardId: jd2.cardId, authorName: "審査員", showAuthorName: true, edits: { ...jd2.draft, tags: ["脚立"] }, trial: true }, judge);
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
const photoQ = await call("sendToBox", { text: "ジョイントボックスの中の結線は何で留める？", photo: "data:image/jpeg;base64,/9j/4AAQ", photoPart: "ジョイントボックス", askerName: "若手1", askerRole: "young" }, asker1);
check("a photo question is never merged", !photoQ.duplicate && !photoQ.merged && photoQ.questionId !== s1.questionId);
const seenPart = (await call("openQuestions", {}, vet)).questions.find((q) => q.id === photoQ.questionId)?.photoPart;
const openedPart = (await call("questionPhoto", { questionId: photoQ.questionId }, vet)).photoPart;
check("the veteran sees what the AI took the photo for", seenPart === "ジョイントボックス" && openedPart === "ジョイントボックス");
// a card from a photo question is searched with the part's name, not the bare words (「これは何に使いますか？」)
const pd = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト）ジョイントボックスの中はリングスリーブで圧着する。" }], authorName: "山田（親方）", triggerQuestionId: photoQ.questionId }, vet);
const pcard = await (await fetch(`${FS}/cards/${pd.cardId}`, { headers: { Authorization: "Bearer owner" } })).json();
check("a photo question's card is searched with the part's name", pcard.fields?.triggerSearchText?.stringValue === "ジョイントボックス");
const jd3 = await call("draftCard", { transcript: [{ role: "veteran", text: "（テスト用）ジョイントボックスの結線は差込形コネクタで留める。" }], authorName: "山田（親方）", triggerQuestionId: s1.questionId }, vet2);
await publish({ cardId: jd3.cardId, authorName: "山田（親方）", showAuthorName: true, edits: { ...jd3.draft, tags: ["ジョイントボックス"] } }, vet2);
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

console.log("\n12. 話のきっかけ");
// an answer no card was used for becomes something to tell; one a card answered does not
// (no 「（テスト）」 here: the dummy answers match it to a test card's title)
const noCard = "分電盤の扉の裏に貼るラベルの書き方は？";
await call("ask", { text: noCard, askerRole: "young" }, young);
const seeds = await call("talkSeeds", {}, vet);
check(
  "a question no card answered is offered to the veteran (words only)",
  Array.isArray(seeds.questions) && seeds.questions.includes(noCard) && !seeds.questions.includes("PF管って何回まで曲げていいですか？") && !JSON.stringify(seeds).includes("askerId"),
  JSON.stringify(seeds.questions),
);

console.log("\n13. 言葉の意味");
const gl = await call("listGlossary", {}, young);
const dTerm = gl.terms.find((t) => t.term === "D種接地工事");
check("words come with a meaning and the article it is from", gl.terms.length >= 50 && !!dTerm?.meanings[0]?.plain && /^電技解釈 第\d+条/.test(dTerm.meanings[0].label), `${gl.terms.length} terms`);

console.log("\n14. 質問の取り下げ");
const wq = await call("sendToBox", { text: "（テスト）取り下げる質問", confirmed: true, photo: "data:image/jpeg;base64,/9j/4AAQ", askerName: "若手1", askerRole: "young" }, asker1);
let othersRefused = false;
try {
  await call("withdrawQuestion", { questionId: wq.questionId }, stranger);
} catch {
  othersRefused = true;
}
check("only one who asked can take a question back", othersRefused);
const wr = await call("withdrawQuestion", { questionId: wq.questionId }, asker1);
const boxAfter = (await call("openQuestions", {}, vet)).questions.some((q) => q.id === wq.questionId);
const mineAfter = (await call("myQuestions", {}, asker1)).questions.some((q) => q.id === wq.questionId);
const photoAfter = (await call("questionPhoto", { questionId: wq.questionId }, vet)).photo;
check("a question taken back leaves the box, the list and its photo", wr.withdrawn && !boxAfter && !mineAfter && photoAfter === null);
// joined by another: the one who leaves goes, the question stays for the other
const twoQ = await call("sendToBox", { text: "（テスト）二人で聞く質問", confirmed: true, askerName: "若手1", askerRole: "young" }, asker1);
await call("sendToBox", { text: "（テスト）二人で聞く質問", confirmed: true, askerName: "若手2", askerRole: "young" }, asker2);
const jr = await call("withdrawQuestion", { questionId: twoQ.questionId }, asker1);
const stays = (await call("openQuestions", {}, vet)).questions.find((q) => q.id === twoQ.questionId);
const forOther = (await call("myQuestions", {}, asker2)).questions.some((q) => q.id === twoQ.questionId);
const forMe = (await call("myQuestions", {}, asker1)).questions.some((q) => q.id === twoQ.questionId);
check("a question others joined stays for them", !jr.withdrawn && !!stays && stays.askers === 1 && forOther && !forMe);
let againMsg = "";
try {
  await call("withdrawQuestion", { questionId: wq.questionId }, asker1);
} catch (e) {
  againMsg = String(e.message ?? e);
}
check("taking back a question already taken back says so", againMsg.includes("もう取り下げてあります"), againMsg);
// passed on to a veteran who joined: it leaves that veteran's own box
const vetQ = await call("sendToBox", { text: "（テスト）ベテランも聞く質問", confirmed: true, askerName: "若手1", askerRole: "young" }, asker1);
await call("sendToBox", { text: "（テスト）ベテランも聞く質問", confirmed: true, askerName: "山田（親方）", askerRole: "veteran" }, vet);
await call("withdrawQuestion", { questionId: vetQ.questionId }, asker1);
const inOwnBox = (await call("openQuestions", {}, vet)).questions.some((q) => q.id === vetQ.questionId);
check("a question passed on to a veteran is not in their own box", !inOwnBox);

console.log("\n15. 条文との照らし合わせ");
{ // its own block: the sections above use the short names
// a story that disagrees with the law on purpose (who may do the work): the check should mark it, not block it
const vet3 = await signUp();
const lt = [{ role: "veteran", text: "（テスト）資格がなくても、コンセントの取り替えくらいはしてよか。ブレーカーを切ってから付け替えればよか。PF管の曲げは1区間で合計270度までにしとる。" }];
const ld = await call("draftCard", { transcript: lt, authorName: "山田（親方）" }, vet3);
// the draft may already soften what was said: put the claim itself in the body, as a veteran could have typed it
// (a plain title and one more plain sentence, so the card still has a title and a body once the claim is held back)
const CLAIM = "資格がなくても、コンセントの取り替えくらいはしてよか。";
const edits = { ...ld.draft, title: "（テスト）コンセントの付け替え", body: `${CLAIM}${ld.draft.body}
（テスト）道具は前の日にそろえておく。`, tags: ld.draft.tags };
const pubData = { cardId: ld.cardId, authorName: "山田（親方）", showAuthorName: true, edits };
let othersCheck = "";
try { await call("checkCard", { cardId: ld.cardId, edits }, stranger); } catch (e) { othersCheck = String(e); }
check("only the card's own device can check it", /permission-denied|PERMISSION_DENIED/.test(othersCheck));
let beforeCheck = "";
try { await call("publishCard", pubData, vet3); } catch (e) { beforeCheck = String(e); }
check("a card is not published before it is checked", /FAILED_PRECONDITION/.test(beforeCheck) && beforeCheck.includes("条文との照らし合わせをしてから公開してください"), beforeCheck.slice(0, 120));
const lc = await call("checkCard", { cardId: ld.cardId, edits }, vet3);
const FIELDS = ["title", "scene", "body", "reason", "caution"];
const termLine = (t) => `${t.word.trim()}：${t.meaning.trim().replace(/\s+/g, " ")}`;
const onEdits = (e, x) => (x.field === "terms" ? (e.terms ?? []).some((t) => termLine(t) === x.text) : (e[x.field] ?? "").includes(x.text));
const shaped = Array.isArray(lc.items) && lc.items.every((x) =>
  [...FIELDS, "plain", "terms"].includes(x.field) && onEdits(edits, x) && ["same", "stricter", "differs", "unsure"].includes(x.verdict) &&
  (x.verdict === "unsure" ? !x.quote : !!x.lawId && !!x.quote) && (x.verdict === "differs" || x.verdict === "unsure" ? !!x.note : !x.note));
check("each mark is on a sentence of the card, with a quote from the article (or 要確認)", shaped, `[${lc.mode}] ${lc.items.length} marks, ${lc.lawCount} articles`);
for (const x of lc.items) console.log(`     [${x.verdict}] ${x.text}  ${x.note}  ${x.label}「${x.quote}」`);
const differs = lc.items.filter((x) => x.verdict === "differs");
// the sentences young workers must never see (⚠️ and 🔍 against a law), and those shown with a note (against 標準仕様書)
const held = lc.items.filter((x) => (x.verdict === "differs" || x.verdict === "unsure") && x.legal !== false).map((x) => x.text);
const specOnly = lc.items.filter((x) => x.verdict === "differs" && x.legal === false).map((x) => x.text);
check("each mark says whether it is against a law or 標準仕様書", lc.items.every((x) => typeof x.legal === "boolean" && (!x.lawId || x.legal === !x.lawId.startsWith("shiyo-"))));
if (lc.mode === "claude") {
  check("a sentence that disagrees with the law is marked ⚠️", differs.some((x) => x.legal));
  // 「若手にはこう見えます」: what would go out, shown to the veteran first; nothing is published by it
  const pv = await call("publishCard", { ...pubData, preview: true }, vet3);
  const pvText = JSON.stringify(pv.preview ?? {});
  check("the preview shows the card without the ⚠️ sentences, and publishes nothing", !!pv.preview?.title && held.every((t) => !pvText.includes(t)) && pv.hidden === held.length && (await clientGet(`cards/${ld.cardId}`)) === 403 && (await call("myCards", {}, vet3)).cards[0]?.status === "draft");
  // published as it is, without taking anything out: the marked sentences stay with the veteran only
  const pub = await call("publishCard", pubData, vet3);
  check("publishing says how many sentences young workers do not see, and only that it was checked", pub.hidden === held.length && JSON.stringify(Object.keys(pub.lawCheck ?? {})) === '["checkedAt"]', `hidden=${pub.hidden} ${JSON.stringify(pub.lawCheck)}`);
  // what a young worker's device reads from Firestore directly
  const doc = await (await fetch(`${FS}/cards/${ld.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).json();
  const docText = JSON.stringify(doc.fields ?? {});
  check("the ⚠️ / 🔍 sentences are not on the card young workers can read", !!doc.fields && held.every((t) => !docText.includes(t)) && !docText.includes(CLAIM.slice(0, 12)), held.join(" / "));
  check("the card young workers read only says it was checked", JSON.stringify(Object.keys(doc.fields?.lawCheck?.mapValue?.fields ?? {})) === '["checkedAt"]' && (doc.fields?.plain?.stringValue ?? "") === "", JSON.stringify(doc.fields?.lawCheck));
  // against 標準仕様書 only (not law): left for young workers, with the note
  check("a sentence that differs only from 標準仕様書 stays, marked for the note", specOnly.every((t) => docText.includes(t)) && (doc.fields?.specDiffers?.arrayValue?.values ?? []).length === specOnly.length, `${specOnly.length} sentence(s)`);
  // ✅ / 🟦 sentences go out with their article and quote (⚖️ 条文で確かめる), never a held-back one
  const refs = (doc.fields?.lawRefs?.arrayValue?.values ?? []).map((v) => Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, x.stringValue])));
  const agreed = lc.items.filter((x) => x.verdict === "same" || x.verdict === "stricter");
  check("the card carries its ✅ / 🟦 sentences with the article and the checked quote", refs.length === agreed.length && refs.every((r) => agreed.some((x) => x.text === r.text && x.verdict === r.verdict && x.lawId === r.lawId && x.quote === r.quote && x.field === r.field) && (doc.fields?.[r.field]?.stringValue ?? "").includes(r.text) && !!r.label), `${refs.length} link(s): ${refs.map((r) => `[${r.verdict}] ${r.label}`).join(" / ")}`);
  check("a held-back sentence is never linked to an article", held.every((t) => !refs.some((r) => r.text === t)) && refs.every((r) => r.verdict === "same" || r.verdict === "stricter"));
  const mineFull = await call("myCard", { cardId: ld.cardId }, vet3);
  check("わたしのカード keeps the veteran's whole card", lc.items.filter((x) => held.includes(x.text)).every((x) => onEdits(mineFull.draft, x)) && mineFull.draft.body === edits.body.trim() && (await call("myCards", {}, vet3)).cards[0]?.title === edits.title);
  const la = await call("ask", { text: "資格がなくてもコンセントの取り替えはしていいですか？", askerRole: "young" }, young);
  const said = la.sentences.map((x) => x.text).join(" ");
  for (const x of la.sentences) console.log(`     [${x.source}] ${x.text}`);
  const refKey = (r) => [r.field, r.text, r.verdict, r.lawId, r.label, r.quote].join("|");
  const usedHere = la.cards.find((c) => c.id === ld.cardId);
  if (usedHere) check("the answer's card carries the same links to the articles", JSON.stringify((usedHere.lawRefs ?? []).map(refKey)) === JSON.stringify(refs.map(refKey)), `${usedHere.lawRefs?.length} link(s)`);
  check("the answer does not carry the ⚠️ sentence", held.every((t) => !said.includes(t.replace(/[。！？]$/, ""))), `[${la.mode}] cards: ${la.cards.map((c) => c.id === ld.cardId ? "this card" : c.id).join(",")}`);
  // a word changed after the check: refused until it is checked again
  let changed = "";
  try { await call("publishCard", { ...pubData, edits: { ...edits, body: edits.body + "（足した文）" } }, vet3); } catch (e) { changed = String(e); }
  check("a card changed after the check is refused until it is checked again", /FAILED_PRECONDITION/.test(changed) && changed.includes("照らし合わせ"), changed.slice(0, 120));
  // hidden and shown again: the same rule (an unsaved edit checked since makes the saved card's check out of date)
  await call("setCardStatus", { cardId: ld.cardId, status: "private" }, vet3);
  await call("setCardStatus", { cardId: ld.cardId, status: "published" }, vet3);
  const again = await (await fetch(`${FS}/cards/${ld.cardId}`, { headers: { Authorization: `Bearer ${young}` } })).json();
  check("shown again from わたしのカード, still without the ⚠️ sentences", again.fields?.status?.stringValue === "published" && held.every((t) => !JSON.stringify(again.fields).includes(t)));
  check("shown again, the links to the articles are made again the same", (again.fields?.lawRefs?.arrayValue?.values ?? []).length === refs.length);
  await call("setCardStatus", { cardId: ld.cardId, status: "private" }, vet3);
  // a word rewritten and checked, but not saved: the saved card is no longer the checked one
  await call("checkCard", { cardId: ld.cardId, edits: { ...edits, body: edits.body.replace("道具は", "工具は") } }, vet3);
  let stale = "";
  try { await call("setCardStatus", { cardId: ld.cardId, status: "published" }, vet3); } catch (e) { stale = String(e); }
  check("a hidden card whose check is out of date is not shown again", /FAILED_PRECONDITION/.test(stale), stale.slice(0, 120));
}
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
