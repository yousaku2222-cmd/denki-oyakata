import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getClient, jsonCall } from "./claude";
import { MODEL_ANSWER } from "./models";
import { CATEGORIES, COMPANY, CardDoc, FieldTerm, LOCATIONS, Turn, db, spaceOf, spacesOf, str, strList, turns } from "./common";
import { takeQuota } from "./limits";
import { lawLabel, numbersMissing, searchLaws } from "./laws";

const MAX_FOLLOW_UPS = 3;
const ENOUGH_CHARS = 12000; // a talk this long has the material: go to the card (common.ts bounds it at 16000)
const DUMMY_FOLLOW_UPS = ["なぜそうするんですか？", "新人がよく間違えるのは、どんなところですか？"];

function transcriptText(t: Turn[]): string {
  return t.map((x) => `${x.role === "veteran" ? "ベテラン" : "聞き手"}: ${x.text}`).join("\n");
}

const INTERVIEW_SYSTEM = `あなたは電気工事会社で、引退が近いベテランの知恵を聞き取る「聞き手」です。
相手はスマホが苦手で、話すのに照れがあります。方言・話し言葉のままで構いません。
これまでのやりとりを読み、知恵カード（場面・やり方・理由・失敗・新人が間違えやすい点）にするために足りないことを、短い質問1つだけで聞き返してください。
- 1回に聞くのは1問だけ。20〜40字。やさしい言葉で、敬語は軽め。
- 優先: なぜそうするか → 失敗したこと・その結果 → 新人がよく間違えること → どんな現場・場面か。すでに話されたことは聞かない。
- 十分に材料がそろったら done=true（question は空文字）。
- 法令や数値の正しさを相手に問いただしたり、説教したりしない。`;

export async function interviewNext(data: Record<string, unknown>) {
  const transcript = turns(data.transcript);
  const asked = transcript.filter((t) => t.role === "ai").length;
  const long = transcript.reduce((n, t) => n + t.text.length, 0) > ENOUGH_CHARS;
  if (asked >= MAX_FOLLOW_UPS || long) return { done: true, question: "", mode: getClient() ? "claude" : "dummy" };

  if (!getClient()) {
    const q = DUMMY_FOLLOW_UPS[asked];
    return { done: !q, question: q ?? "", mode: "dummy" };
  }
  const topic = str(data.questionText, "質問", 1200, false);
  const r = await jsonCall<{ done: boolean; question: string }>({
    model: MODEL_ANSWER,
    system: INTERVIEW_SYSTEM,
    user: `${topic ? `若手からの質問（これに答える話です）: ${topic}\n${topic.includes("写真の物は") ? "（写真の物と質問の言葉が合わない時は、若手の聞き方がずれているだけのことが多い。親方が写真の物について役立つ話をしていれば、それで良い）\n" : ""}\n` : ""}これまでのやりとり:\n${transcriptText(transcript)}`,
    schema: {
      type: "object",
      properties: { done: { type: "boolean" }, question: { type: "string" } },
      required: ["done", "question"],
      additionalProperties: false,
    },
    maxTokens: 2000,
  });
  return { done: r.done, question: r.done ? "" : r.question, mode: "claude" };
}

interface Draft {
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  tags: string[];
  category: CardDoc["category"];
  location: CardDoc["location"];
  relatedLaws: string[];
  terms: FieldTerm[];
  plain: string;
}

const DRAFT_SYSTEM = `電気工事のベテランの話を「知恵カード」に整理します。
- ベテランが実際に話した内容だけを使う。話していない数値・手順・法令を足さない。
- 言い回しは現場の言葉を残し、若手が読んでわかる短い文に整える（各項目60〜150字目安）。
- title: 一言でいうと（30字以内）／scene: どんな現場・場面か／body: やり方・コツ／reason: なぜそうするか、やらかした失敗とその結果／caution: 新人がよく間違えること（話に無ければ空文字）
- tags: 検索用。部材や工具の別名・現場の呼び名・略称（例: PF管→「PF」「合成樹脂可とう電線管」）を5〜10個
- relatedLaws: ベテランが法令・基準に触れた場合だけ、その名前（例「電技解釈 第158条」）。推測で足さない
- terms: カードの文（title・scene・body・reason・caution）に出てくる、若手には通じにくい言葉と、その意味（0〜8個）。
  - 入れるのは、方言の言い回し（例「多か時は」）・会社や地域だけの呼び名・現場の略語（例「プルボ」）だけ。漏電遮断器・PF管のような一般的な電気の専門用語は、別の用語集が説明するので入れない。
  - word はカードの文に書いたとおりの表記をそのまま（言い換えたり、送り仮名を変えたりしない）。meaning は若手向けのやさしい言葉で30字以内（例: プルボ→「プルボックス。電線をまとめて通す箱」）。
  - 話から意味が分からない言葉は入れない。通じにくい言葉が無ければ空の配列。
- plain: カードの文の方言が強く、若手が読んでも意味が取りにくい時だけ、やり方・コツ（body）の中身を標準語で言い換えた文（150字以内、話に無いことは足さない）。普通に読めるカードなら空文字`;

// What a published card may hold (publishCard checks these; drafts are cut to fit so they can be published).
export const CARD_LIMITS = { title: 60, scene: 500, body: 1500, reason: 1000, caution: 1000, tags: 15, tag: 30, terms: 8, word: 20, meaning: 40, plain: 400 } as const;
// cut by characters, not UTF-16 units: half an emoji would be saved as "�"
const cut = (s: string, n: number) => (s.length <= n ? s : Array.from(s).slice(0, n).join("").slice(0, n).replace(/[\uD800-\uDBFF]$/, ""));
function fitDraft(d: Draft): Draft {
  return {
    ...d,
    title: cut(d.title, CARD_LIMITS.title),
    scene: cut(d.scene, CARD_LIMITS.scene),
    body: cut(d.body, CARD_LIMITS.body),
    reason: cut(d.reason, CARD_LIMITS.reason),
    caution: cut(d.caution, CARD_LIMITS.caution),
    // the edit screen splits the words at 、 and line breaks only, so a word may keep its spaces
    tags: d.tags.flatMap((x) => x.split(/[、,\n]+/)).map((x) => cut(x.trim(), CARD_LIMITS.tag)).filter(Boolean).slice(0, CARD_LIMITS.tags),
    terms: d.terms.map((t) => ({ word: t.word, meaning: cut(t.meaning.trim(), CARD_LIMITS.meaning) })),
    plain: cut(d.plain.trim(), CARD_LIMITS.plain),
  };
}

/**
 * The words of a card that get a meaning: only those really written on it (the screens underline them where they
 * are read, so a word the AI spelt another way, or one the veteran has since rewritten, would mark nothing), once each.
 */
export function fitTerms(terms: FieldTerm[], d: Pick<Draft, "title" | "scene" | "body" | "reason" | "caution">): FieldTerm[] {
  const text = [d.title, d.scene, d.body, d.reason, d.caution].join("\n");
  const seen = new Set<string>();
  return terms
    .map((t) => ({ word: t.word.trim(), meaning: t.meaning.trim() }))
    .filter((t) => {
      if (!t.word || !t.meaning || t.word === t.meaning || t.word.length > CARD_LIMITS.word || !text.includes(t.word) || seen.has(t.word)) return false;
      seen.add(t.word);
      return true;
    })
    .slice(0, CARD_LIMITS.terms);
}

/** The words and meanings sent back from the edit screen (callable data is untrusted). */
export function termList(v: unknown): FieldTerm[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > CARD_LIMITS.terms) throw new HttpsError("invalid-argument", `現場の言葉は${CARD_LIMITS.terms}個までです`);
  return v.map((x) => {
    if (typeof x !== "object" || x === null) throw new HttpsError("invalid-argument", "現場の言葉の形式が違います");
    const t = x as Record<string, unknown>;
    return { word: str(t.word, "現場の言葉", CARD_LIMITS.word), meaning: str(t.meaning, "言葉の意味", CARD_LIMITS.meaning) };
  });
}

const draftText = (d: Pick<Draft, "title" | "scene" | "body" | "reason" | "caution">) => [d.title, d.scene, d.body, d.reason, d.caution].join(" ");

/**
 * The numbers of a draft that the veteran never said (the model was told not to add any, this checks it).
 * The edit screen shows them, so the veteran can fix a figure before it goes out as their knowledge.
 */
export function unsaidNumbers(d: Pick<Draft, "title" | "scene" | "body" | "reason" | "caution">, transcript: Turn[]): string[] {
  return numbersMissing(draftText(d), transcript.map((t) => t.text).join(" ")); // a figure the interviewer asked about counts as said
}

// a value with a unit of measure: a figure a rule could also set (dates and counts of years are left alone)
const MEASURE = /(\d+(?:\.\d+)?)\s*(mm²|mm2|mm|cm|km|m(?![A-Za-z])|kV|V|mA|A|MΩ|Ω|kW|度|°|箇所|か所|カ所|ヶ所|ケ所|%|倍)/g;

/**
 * The card's figures against the rules it is about: a value no related article has may differ from the rule
 * (or be a stricter house rule). Only a note to the veteran: the card is theirs, and the answer still puts
 * the article first when they disagree (ANSWER_SYSTEM).
 */
export function lawNumberNotes(d: Pick<Draft, "title" | "scene" | "body" | "reason" | "caution"> & { tags: string[] }): string[] {
  const laws = searchLaws(`${d.title} ${d.tags.join(" ")}`, 3);
  if (!laws.length) return [];
  const values = [...new Set([...draftText(d).normalize("NFKC").matchAll(MEASURE)].map((m) => m[0].replace(/\s+/g, "")))];
  const off = values.filter((v) => laws.every((l) => numbersMissing(v, `${l.text} ${l.summary}`).length));
  if (!off.length) return [];
  return [`${off.map((v) => `「${v}」`).join("")}は、関係しそうな条文（${laws.map(lawLabel).join("、")}）に無い数値です。条文と同じ値か、条文より厳しい社内の決まりかを確かめてください。`];
}

function dummyDraft(t: Turn[]): Draft {
  const v = t.filter((x) => x.role === "veteran").map((x) => x.text);
  return {
    title: v[0].slice(0, 30),
    scene: "",
    body: v[0],
    reason: v[1] ?? "",
    caution: v[2] ?? "",
    tags: [],
    category: "other",
    location: "other",
    relatedLaws: [],
    terms: [],
    plain: "",
  };
}

export async function draftCard(data: Record<string, unknown>, uid: string) {
  const transcript = turns(data.transcript);
  if (!transcript.some((t) => t.role === "veteran")) throw new HttpsError("invalid-argument", "nothing was said");
  const authorId = uid;
  const authorName = str(data.authorName, "名前", 30, false);
  const triggerQuestionId = str(data.triggerQuestionId, "質問の番号", 64, false) || null;

  let draft: Draft;
  let mode: "claude" | "dummy" = "dummy";
  if (getClient()) {
    draft = await jsonCall<Draft>({
      model: MODEL_ANSWER,
      system: DRAFT_SYSTEM,
      user: transcriptText(transcript),
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          scene: { type: "string" },
          body: { type: "string" },
          reason: { type: "string" },
          caution: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          category: { type: "string", enum: [...CATEGORIES] },
          location: { type: "string", enum: [...LOCATIONS] },
          relatedLaws: { type: "array", items: { type: "string" } },
          terms: {
            type: "array",
            items: {
              type: "object",
              properties: { word: { type: "string" }, meaning: { type: "string" } },
              required: ["word", "meaning"],
              additionalProperties: false,
            },
          },
          plain: { type: "string" },
        },
        required: ["title", "scene", "body", "reason", "caution", "tags", "category", "location", "relatedLaws", "terms", "plain"],
        additionalProperties: false,
      },
    });
    mode = "claude";
  } else {
    draft = dummyDraft(transcript);
  }

  draft = fitDraft(draft);
  draft.terms = fitTerms(draft.terms, draft);

  let triggerAskerName: string | null = null;
  let triggerQuestionText: string | null = null;
  let triggerSearchText: string | null = null;
  if (triggerQuestionId) {
    const q = await db.collection("questions").doc(triggerQuestionId).get();
    // only a question this device can read: a judge may answer a shared question (it stays open, see publishCard),
    // but a judge's trial question must never show on a shared card
    if (!q.exists || !spacesOf(data, uid).includes(q.get("companyId") as string)) throw new HttpsError("not-found", "question not found");
    triggerAskerName = (q.get("askerName") as string) || "若手";
    triggerQuestionText = (q.get("text") as string) || null;
    // a photo question's words lean on the photo (「これは何に使いますか？」 would match every 「何に使う」 question):
    // it is searched by the part the AI took the photo for, or not at all
    const part = q.get("hasPhoto") ? ((q.get("photoPart") as string | null | undefined) ?? "") : null;
    triggerSearchText = part === null ? triggerQuestionText : part;
  }

  const now = Timestamp.now();
  const card: CardDoc = {
    companyId: spaceOf(data, uid), // 審査員モードなら本人にだけ見える
    ...draft,
    tags: draft.tags,
    authorName,
    showAuthorName: true,
    status: "draft",
    visibility: "company",
    region: null,
    powerCompany: null,
    confirmations: [],
    helpedCount: 0,
    viewCount: 0,
    triggerQuestionId,
    triggerAskerName,
    triggerQuestionText,
    triggerSearchText,
    // Published cards are readable by every signed-in device, so the raw interview and the real name live in a
    // server-only document (cardPrivate is closed to clients by firestore.rules).
    transcript: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  const ref = db.collection("cards").doc();
  const batch = db.batch();
  batch.set(ref, card);
  batch.set(db.collection("cardPrivate").doc(ref.id), { authorId, authorName, transcript, createdAt: now });
  await batch.commit();
  // for the edit screen: figures to look at before publishing
  return { cardId: ref.id, draft, mode, unsaidNumbers: unsaidNumbers(draft, transcript), lawNotes: lawNumberNotes(draft) };
}

/** The card, if this device wrote it. The owner is kept in cardPrivate (older cards: on the card itself). */
async function ownCard(cardId: string, authorId: string) {
  const ref = db.collection("cards").doc(cardId);
  const [snap, priv] = await Promise.all([ref.get(), db.collection("cardPrivate").doc(cardId).get()]);
  if (!snap.exists) throw new HttpsError("not-found", "このカードは見つかりません（消されたか、別の端末へ移りました）。");
  const owner = (priv.get("authorId") as string | undefined) ?? (snap.get("authorId") as string | undefined);
  if (owner !== authorId) throw new HttpsError("permission-denied", "この端末のカードではありません（別の端末へ移った場合は、その端末で操作してください）。");
  return { ref, card: snap.data() as CardDoc };
}

export async function publishCard(data: Record<string, unknown>, uid: string, ctx?: { ip: string }) {
  const cardId = str(data.cardId, "カードの番号", 64);
  const authorId = uid;
  const e = (data.edits ?? {}) as Record<string, unknown>;
  const { ref, card } = await ownCard(cardId, authorId);
  // check every field first: a refused edit must not use up a publication
  const fields = {
    title: str(e.title, "題名", CARD_LIMITS.title),
    scene: str(e.scene, "場面", CARD_LIMITS.scene, false),
    body: str(e.body, "やり方・コツ", CARD_LIMITS.body),
    reason: str(e.reason, "理由・失敗", CARD_LIMITS.reason, false),
    caution: str(e.caution, "新人が間違えること", CARD_LIMITS.caution, false),
    tags: strList(e.tags, "探す時の言葉", CARD_LIMITS.tags, CARD_LIMITS.tag), // a short list: long ones would match every question
    plain: str(e.plain, "標準語の言い換え", CARD_LIMITS.plain, false),
  };
  // a word the veteran has since rewritten is no longer on the card: its meaning is dropped, not refused
  const terms = fitTerms(termList(e.terms), fields);
  const nameIn = str(data.authorName, "名前", 30, false);
  // Anyone can act as a veteran (no login by design), so first publications per device are capped; so are later
  // fixes, since each one makes the saved answers of the cards' questions stale (ask.ts cacheKey).
  await takeQuota(authorId, card.status === "draft" ? "publish" : "edit", ctx?.ip);
  const privRef = db.collection("cardPrivate").doc(cardId);
  const priv = await privRef.get();
  const authorName = nameIn || (priv.get("authorName") as string | undefined) || card.authorName;
  const showAuthorName = data.showAuthorName !== false;
  // The card itself is public: keep the name out of it unless the veteran chose to show it.
  const shownName = showAuthorName ? authorName : "";
  const now = Timestamp.now();
  const newStatus: CardDoc["status"] = card.status === "private" ? "private" : "published";

  // a card from before cardPrivate: its interview moves out of the public card here
  await privRef.set({ authorId, authorName, ...(card.transcript?.length ? { transcript: card.transcript } : {}) }, { merge: true });
  await ref.update({
    ...fields,
    terms,
    authorName: shownName,
    showAuthorName,
    // editing a hidden card keeps it hidden; a draft or a published card is (re)published
    status: newStatus,
    // only the shown name and the time: no device id on a public card (it would link hidden-name cards)
    confirmations: [{ name: shownName, at: now }],
    authorId: FieldValue.delete(), // cards from before cardPrivate carried it
    transcript: [],
    updatedAt: now,
    publishedAt: card.publishedAt ?? now,
  });

  if (card.triggerQuestionId) {
    const qRef = db.collection("questions").doc(card.triggerQuestionId);
    const q = await qRef.get();
    // a judge's trial card does not close a question in the shared box
    if (q.exists && q.get("status") === "open" && q.get("companyId") === card.companyId) {
      await qRef.update({ status: "answered", answeredCardId: cardId, answeredAt: now });
      const askerId = q.get("askerId") as string;
      await db.collection("users").doc(askerId).set({ answeredFromMyQuestions: FieldValue.increment(1) }, { merge: true });
    }
  }
  return { ok: true, status: newStatus, lawNotes: lawNumberNotes(fields) };
}

export async function setCardStatus(data: Record<string, unknown>, uid: string, ctx?: { ip: string }) {
  const cardId = str(data.cardId, "カードの番号", 64);
  const authorId = uid;
  const status = data.status;
  if (status !== "published" && status !== "private") throw new HttpsError("invalid-argument", "status is invalid");
  const { ref, card } = await ownCard(cardId, authorId);
  if (card.status === "draft") throw new HttpsError("failed-precondition", "publish the draft first");
  if (card.status === status) return { ok: true }; // nothing changes: no count, no new version
  await takeQuota(authorId, "edit", ctx?.ip);
  await ref.update({ status, updatedAt: Timestamp.now() });
  return { ok: true };
}

export async function myCards(_data: Record<string, unknown>, uid: string) {
  const [priv, legacy] = await Promise.all([
    db.collection("cardPrivate").where("authorId", "==", uid).get(),
    db.collection("cards").where("companyId", "==", COMPANY).where("authorId", "==", uid).get(),
  ]);
  const ids = [...new Set([...priv.docs.map((d) => d.id), ...legacy.docs.map((d) => d.id)])];
  const docs = ids.length ? (await db.getAll(...ids.map((id) => db.collection("cards").doc(id)))).filter((d) => d.exists) : [];
  return {
    cards: docs
      .map((d) => {
        const c = d.data() as CardDoc;
        return {
          id: d.id,
          title: c.title,
          status: c.status,
          helpedCount: c.helpedCount,
          triggerAskerName: c.triggerAskerName,
          updatedAt: c.updatedAt.toMillis(),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

/** One of my cards, to go on editing it (a draft left behind, or a published card to fix). */
export async function myCard(data: Record<string, unknown>, uid: string) {
  const cardId = str(data.cardId, "カードの番号", 64);
  const { card } = await ownCard(cardId, uid);
  const priv = await db.collection("cardPrivate").doc(cardId).get();
  return {
    cardId,
    status: card.status,
    draft: { title: card.title, scene: card.scene, body: card.body, reason: card.reason, caution: card.caution, tags: card.tags, terms: card.terms ?? [], plain: card.plain ?? "" },
    authorName: (priv.get("authorName") as string | undefined) ?? card.authorName,
    showAuthorName: card.showAuthorName,
    topic: card.triggerQuestionText ? { questionId: card.triggerQuestionId ?? "", text: card.triggerQuestionText, askerName: card.triggerAskerName ?? "若手" } : null,
    // what was told (and asked back), to the writer only: so a later fix keeps to what was really said
    transcript: ((priv.get("transcript") as Turn[] | undefined) ?? card.transcript ?? []).slice(0, 60),
  };
}

/** A draft that will not be published: remove it (published cards are hidden with setCardStatus instead). */
export async function deleteDraft(data: Record<string, unknown>, uid: string) {
  const cardId = str(data.cardId, "カードの番号", 64);
  const { ref, card } = await ownCard(cardId, uid);
  if (card.status !== "draft") throw new HttpsError("failed-precondition", "公開したカードは消さずに「非公開にする」を使ってください。");
  const batch = db.batch();
  batch.delete(ref);
  batch.delete(db.collection("cardPrivate").doc(cardId));
  await batch.commit();
  return { ok: true };
}
