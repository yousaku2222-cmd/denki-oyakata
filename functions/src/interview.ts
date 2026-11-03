import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getClient, jsonCall } from "./claude";
import { MODEL_ANSWER } from "./models";
import { CATEGORIES, COMPANY, CardDoc, LOCATIONS, Turn, db, spaceOf, str, strList, turns } from "./common";
import { takeQuota } from "./limits";

const MAX_FOLLOW_UPS = 3;
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
  if (asked >= MAX_FOLLOW_UPS) return { done: true, question: "", mode: getClient() ? "claude" : "dummy" };

  if (!getClient()) {
    const q = DUMMY_FOLLOW_UPS[asked];
    return { done: !q, question: q ?? "", mode: "dummy" };
  }
  const topic = str(data.questionText, "質問", 500, false);
  const r = await jsonCall<{ done: boolean; question: string }>({
    model: MODEL_ANSWER,
    system: INTERVIEW_SYSTEM,
    user: `${topic ? `若手からの質問（これに答える話です）: ${topic}\n\n` : ""}これまでのやりとり:\n${transcriptText(transcript)}`,
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
}

const DRAFT_SYSTEM = `電気工事のベテランの話を「知恵カード」に整理します。
- ベテランが実際に話した内容だけを使う。話していない数値・手順・法令を足さない。
- 言い回しは現場の言葉を残し、若手が読んでわかる短い文に整える（各項目60〜150字目安）。
- title: 一言でいうと（30字以内）／scene: どんな現場・場面か／body: やり方・コツ／reason: なぜそうするか、やらかした失敗とその結果／caution: 新人がよく間違えること（話に無ければ空文字）
- tags: 検索用。部材や工具の別名・現場の呼び名・略称（例: PF管→「PF」「合成樹脂可とう電線管」）を5〜10個
- relatedLaws: ベテランが法令・基準に触れた場合だけ、その名前（例「電技解釈 第158条」）。推測で足さない`;

// What a published card may hold (publishCard checks these; drafts are cut to fit so they can be published).
export const CARD_LIMITS = { title: 60, scene: 500, body: 1500, reason: 1000, caution: 1000, tags: 15, tag: 30 } as const;
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
  };
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
        },
        required: ["title", "scene", "body", "reason", "caution", "tags", "category", "location", "relatedLaws"],
        additionalProperties: false,
      },
    });
    mode = "claude";
  } else {
    draft = dummyDraft(transcript);
  }

  draft = fitDraft(draft);

  let triggerAskerName: string | null = null;
  let triggerQuestionText: string | null = null;
  if (triggerQuestionId) {
    const q = await db.collection("questions").doc(triggerQuestionId).get();
    if (!q.exists) throw new HttpsError("not-found", "question not found");
    triggerAskerName = (q.get("askerName") as string) || "若手";
    triggerQuestionText = (q.get("text") as string) || null;
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
  return { cardId: ref.id, draft, mode };
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
  };
  const nameIn = str(data.authorName, "名前", 30, false);
  // Anyone can act as a veteran (no login by design), so first publications per device are capped.
  if (card.status === "draft") await takeQuota(authorId, "publish", ctx?.ip);
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
  return { ok: true, status: newStatus };
}

export async function setCardStatus(data: Record<string, unknown>, uid: string) {
  const cardId = str(data.cardId, "カードの番号", 64);
  const authorId = uid;
  const status = data.status;
  if (status !== "published" && status !== "private") throw new HttpsError("invalid-argument", "status is invalid");
  const { ref, card } = await ownCard(cardId, authorId);
  if (card.status === "draft") throw new HttpsError("failed-precondition", "publish the draft first");
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
    draft: { title: card.title, scene: card.scene, body: card.body, reason: card.reason, caution: card.caution, tags: card.tags },
    authorName: (priv.get("authorName") as string | undefined) ?? card.authorName,
    showAuthorName: card.showAuthorName,
    topic: card.triggerQuestionText ? { questionId: card.triggerQuestionId ?? "", text: card.triggerQuestionText, askerName: card.triggerAskerName ?? "若手" } : null,
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
