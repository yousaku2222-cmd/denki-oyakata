import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getClient, jsonCall } from "./claude";
import { MODEL_ANSWER, MODEL_ROUTER } from "./models";
import { searchCards } from "./search";
import { COMPANY, CardDoc, Sentence, db, deviceId, displayAuthor, safetyNote, str } from "./common";

type Card = CardDoc & { id: string };

async function publishedCards(): Promise<Card[]> {
  const snap = await db.collection("cards").where("companyId", "==", COMPANY).where("status", "==", "published").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as CardDoc) }));
}

interface Routed {
  interpretedAs: string;
  kind: "law" | "calc" | "part" | "howto" | "other";
  searchTerms: string[];
}

const ROUTER_SYSTEM = `電気工事の現場の若手からの質問を受け取ります。話し言葉・方言・現場の呼び名（例「VE」「ねじなし」「サンダー」）のままです。
- interpretedAs: 質問の意味を、標準的な言葉で1文に言い直す（「こう受け取りました」として本人に見せる）
- kind: law=法令・基準・資格／calc=計算・判定／part=部材・工具の名前や用途／howto=やり方・コツ／other
- searchTerms: 社内の知恵カードを探すための言い換え・正式名・別名・関係する作業名を3〜8個`;

const ANSWER_SYSTEM = `あなたは電気工事会社の「でんきの親方」アプリで、若手の質問に答えます。
答えは一文ずつ、出どころ(source)を付けて返します。
- wisdom: 渡された「社内の知恵カード」に書かれている内容だけ。必ず cardId を付ける。カードに無いことを wisdom にしない。
- general: 一般的な知識。確かな範囲だけを短く。条文番号や数値を言い切らない（法令の引用は別の仕組みで行う）。
- 知恵カードを最初に、一般知識は補足として。全体で2〜6文、1文60字以内、現場でスマホで読める言葉で。
- 関係するカードが無く、一般知識でも確かに答えられない時は sentences を空にする。
- 資格が要る作業・活線作業に触れる時は、無資格者ができない範囲をはっきり書く。`;

function dummyAnswer(text: string, hits: Card[]): Sentence[] {
  if (!hits.length) return [];
  const c = hits[0];
  const s: Sentence[] = [{ text: `${c.title}。${c.body}`, source: "wisdom", cardId: c.id }];
  if (c.reason) s.push({ text: c.reason, source: "wisdom", cardId: c.id });
  if (c.caution) s.push({ text: `新人が間違えやすい点: ${c.caution}`, source: "wisdom", cardId: c.id });
  s.push({ text: `（ダミー応答）APIキーが入ると、「${text.slice(0, 20)}」への一般的な説明がここに入ります。`, source: "general" });
  return s;
}

/** Program-side check: a wisdom sentence must point at a card we actually gave the model. */
export function enforceSources(sentences: Sentence[], allowedCardIds: Set<string>): Sentence[] {
  return sentences
    .filter((s) => s.text.trim())
    .map((s) => {
      if (s.source === "wisdom" && (!s.cardId || !allowedCardIds.has(s.cardId))) return { text: s.text, source: "general" as const };
      if (s.source === "law") return { text: s.text, source: "general" as const }; // law answers arrive in stage 2
      return s.source === "general" ? { text: s.text, source: "general" as const } : s;
    });
}

export async function ask(data: Record<string, unknown>) {
  const text = str(data.text, "text", 500);
  const askerId = deviceId(data.askerId);
  const askerRole = data.askerRole === "veteran" ? "veteran" : "young";
  const cards = await publishedCards();

  let interpretedAs = text;
  let sentences: Sentence[];
  let hits: Card[];
  let mode: "claude" | "dummy" = "dummy";
  const models: Record<string, string> = {};

  if (getClient()) {
    mode = "claude";
    const routed = await jsonCall<Routed>({
      model: MODEL_ROUTER,
      system: ROUTER_SYSTEM,
      user: text,
      schema: {
        type: "object",
        properties: {
          interpretedAs: { type: "string" },
          kind: { type: "string", enum: ["law", "calc", "part", "howto", "other"] },
          searchTerms: { type: "array", items: { type: "string" } },
        },
        required: ["interpretedAs", "kind", "searchTerms"],
        additionalProperties: false,
      },
      maxTokens: 500,
    });
    models.router = MODEL_ROUTER;
    interpretedAs = routed.interpretedAs || text;
    hits = searchCards(`${text} ${routed.searchTerms.join(" ")}`, cards, 5, 0.8).map((r) => r.card);

    const cardText = hits.length
      ? hits
          .map((c) => `[cardId=${c.id}] ${c.title}\n場面: ${c.scene}\nやり方: ${c.body}\n理由・失敗: ${c.reason}\n新人の間違い: ${c.caution}`)
          .join("\n\n")
      : "（関係する知恵カードはありません）";
    const r = await jsonCall<{ sentences: Sentence[] }>({
      model: MODEL_ANSWER,
      system: ANSWER_SYSTEM,
      user: `質問: ${text}\n（こう受け取りました: ${interpretedAs}）\n\n社内の知恵カード:\n${cardText}`,
      schema: {
        type: "object",
        properties: {
          sentences: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                source: { type: "string", enum: ["wisdom", "general"] },
                cardId: { type: "string" },
              },
              required: ["text", "source"],
              additionalProperties: false,
            },
          },
        },
        required: ["sentences"],
        additionalProperties: false,
      },
      maxTokens: 1500,
    });
    models.answer = MODEL_ANSWER;
    sentences = enforceSources(r.sentences, new Set(hits.map((c) => c.id)));
  } else {
    hits = searchCards(text, cards, 5).map((r) => r.card);
    sentences = dummyAnswer(text, hits);
  }

  const usedCardIds = [...new Set(sentences.flatMap((s) => (s.source === "wisdom" && s.cardId ? [s.cardId] : [])))];
  const grounded = usedCardIds.length > 0;
  const ref = await db.collection("answers").add({
    companyId: COMPANY,
    question: text,
    interpretedAs,
    sentences,
    grounded,
    usedCardIds,
    usedLawIds: [],
    helped: false,
    askerId,
    askerRole,
    mode,
    models,
    createdAt: Timestamp.now(),
  });
  await Promise.all(usedCardIds.map((id) => db.collection("cards").doc(id).update({ viewCount: FieldValue.increment(1) })));
  await db.collection("users").doc(askerId).set({ askedCount: FieldValue.increment(1) }, { merge: true });

  const byId = new Map(hits.map((c) => [c.id, c]));
  return {
    answerId: ref.id,
    interpretedAs,
    sentences,
    grounded,
    mode,
    safetyNote: safetyNote(`${text} ${sentences.map((s) => s.text).join(" ")}`),
    cards: usedCardIds.map((id) => {
      const c = byId.get(id)!;
      return {
        id,
        title: c.title,
        author: displayAuthor(c),
        publishedAt: c.publishedAt?.toMillis() ?? null,
        triggerAskerName: c.triggerAskerName,
      };
    }),
  };
}

export async function markHelped(data: Record<string, unknown>) {
  const answerId = str(data.answerId, "answerId", 64);
  const askerId = deviceId(data.askerId);
  const ref = db.collection("answers").doc(answerId);
  await db.runTransaction(async (tx) => {
    const a = await tx.get(ref);
    if (!a.exists) throw new HttpsError("not-found", "answer not found");
    if (a.get("askerId") !== askerId) throw new HttpsError("permission-denied", "not your answer");
    if (a.get("helped")) return;
    tx.update(ref, { helped: true });
    for (const id of a.get("usedCardIds") as string[]) {
      tx.update(db.collection("cards").doc(id), { helpedCount: FieldValue.increment(1) });
    }
  });
  return { ok: true };
}
