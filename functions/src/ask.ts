import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getClient, jsonCall, pickTools } from "./claude";
import { CalcOutput, calcTools, runCalc } from "./calc";
import { CalcInputError } from "./calc/types";
import { MODEL_ANSWER, MODEL_ROUTER } from "./models";
import { searchCards } from "./search";
import { Law, getLawById, quoteIsInOriginal, searchLaws } from "./laws";
import { COMPANY, CardDoc, Sentence, db, displayAuthor, safetyNote, str } from "./common";

export type Card = CardDoc & { id: string };

export async function publishedCards(): Promise<Card[]> {
  const snap = await db.collection("cards").where("companyId", "==", COMPANY).where("status", "==", "published").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as CardDoc) }));
}

interface Routed {
  interpretedAs: string;
  kind: "law" | "calc" | "part" | "howto" | "other";
  searchTerms: string[];
}

const ROUTER_SYSTEM = `電気工事の現場の若手からの質問を受け取ります。話し言葉・方言・現場の呼び名（例「VE」「ねじなし」「サンダー」）のままです。
- interpretedAs: 質問の意味を、標準的な言葉で1文・40字以内に言い直す（「こう受け取りました」として本人に見せる。推測の説明は書かない）
- kind: law=法令・基準・資格／calc=計算・判定／part=部材・工具の名前や用途／howto=やり方・コツ／other
- searchTerms: 社内の知恵カードと法令を探すための言い換え・正式名・別名・関係する作業名・法令の用語を3〜8個`;

const ANSWER_SYSTEM = `あなたは電気工事会社の「でんきの親方」アプリで、若手の質問に答えます。
答えは一文ずつ、出どころ(source)を付けて返します。
- law: 渡された「法令・基準」の条文に書かれていることだけ。必ず lawId と quote を付ける。quote は条文の原文から一続きでそのまま抜き出した部分（10〜80字。言い換え・省略・漢数字の書き換えをしない。「〜とする。」「〜こと。」など意味の切れ目で終える）。プログラムが原文と照合し、一致しなければ法令として表示されない。
- wisdom: 渡された「社内の知恵カード」に書かれている内容だけ。必ず cardId を付ける。カードに無いことを wisdom にしない。
- general: 一般的な知識。確かな範囲だけを短く。条文番号や数値を言い切らない。
- 質問に関係する知恵カードがあれば、必ず wisdom を1文以上入れる（親方の現場の知恵は、法令と同じくらい大事な答え）。カードに書かれている内容を言う文は、言い換えても必ず wisdom にする（general にしない）。
- 順番は law → wisdom → general。全体で2〜7文、text は1文60字以内、現場でスマホで読める言葉で（quote は長さに数えない）。
- 「計算結果（プログラム）」が渡されたら、その数値と判定をそのまま使って答える（自分で計算し直さない、数値を変えない）。計算結果の内容を言う文は general にしてよい（画面に計算の過程が別に出る）。
- 質問に関係しない条文・カードは使わない。関係するものが無く、一般知識でも確かに答えられない時は sentences を空にする。
- 資格が要る作業・活線作業に触れる時は、無資格者ができない範囲をはっきり書く。
- 文体は標準語の「です・ます」。親方の言い回しは wisdom の文の中でだけ残してよい。
- 「カードに載っていない」など、仕組みの内側の話は書かない。`;

const STRONG_MATCH = 1.0; // card search score above which a card is surely about the question

const CALC_PICK_SYSTEM = `電気工事の若手の質問に、計算・判定の道具が使えるかを判断します。
- 道具で答えられる部分があれば、その道具を呼び、質問から読み取れる値を入れる。読み取れない値は入れない（既定値が使われる）。
- 「何本入る？」のように候補を比べる質問は、同じ道具を条件を変えて2回まで呼んでよい。
- 道具で答えられない質問なら、道具を呼ばずに「なし」とだけ答える。`;

function dummyAnswer(text: string, hits: Card[], laws: Law[]): Sentence[] {
  const s: Sentence[] = laws
    .slice(0, 1)
    .map((l) => ({ text: l.summary.split("。")[0] + "。", source: "law", lawId: l.id, quote: l.text.split("\n")[0].slice(0, 40) }));
  if (!hits.length) return s;
  const c = hits[0];
  s.push({ text: `${c.title}。${c.body}`, source: "wisdom", cardId: c.id });
  if (c.reason) s.push({ text: c.reason, source: "wisdom", cardId: c.id });
  if (c.caution) s.push({ text: `新人が間違えやすい点: ${c.caution}`, source: "wisdom", cardId: c.id });
  s.push({ text: `（ダミー応答）APIキーが入ると、「${text.slice(0, 20)}」への一般的な説明がここに入ります。`, source: "general" });
  return s;
}

/**
 * Program-side checks, so a wrong citation never shows as a source:
 * - wisdom must point at a card we actually gave the model
 * - law must point at an article we gave it, and its quote must appear word for word in that article
 * Anything that fails is shown as general knowledge (要確認) instead.
 */
export function enforceSources(sentences: Sentence[], allowedCardIds: Set<string>, allowedLawIds: Set<string>): Sentence[] {
  const general = (text: string): Sentence => ({ text, source: "general" });
  return sentences
    .filter((s) => s.text.trim())
    .map((s) => {
      if (s.source === "wisdom") return s.cardId && allowedCardIds.has(s.cardId) ? { text: s.text, source: "wisdom", cardId: s.cardId } : general(s.text);
      if (s.source === "law") {
        const law = s.lawId && allowedLawIds.has(s.lawId) ? getLawById(s.lawId) : undefined;
        if (!law || !s.quote || !quoteIsInOriginal(s.quote, law.text)) return general(s.text);
        const quote = s.quote.replace(/^[「『]|[」』]$/g, "").replace(/｜/g, " ").trim(); // ｜ = table cell break
        return { text: s.text, source: "law", lawId: law.id, quote, verified: true };
      }
      return general(s.text);
    });
}

export async function ask(data: Record<string, unknown>, uid: string) {
  const text = str(data.text, "text", 500);
  const askerId = uid;
  const askerRole = data.askerRole === "veteran" ? "veteran" : "young";
  const cards = await publishedCards();

  let interpretedAs = text;
  let sentences: Sentence[];
  let hits: Card[];
  let laws: Law[];
  let strongCard: Card | undefined;
  const calcs: CalcOutput[] = [];
  const calcErrors: string[] = [];
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
      maxTokens: 2000,
      effort: "low",
    });
    models.router = MODEL_ROUTER;
    interpretedAs = routed.interpretedAs || text;
    // The score is the share of query bigrams found, so keep the query short (no rephrased sentence).
    const query = `${text} ${routed.searchTerms.join(" ")}`;
    // Extra search words can dilute the score (it is a share of the query), so also search with the question alone.
    const best = new Map<string, { card: Card; score: number }>();
    for (const r of [...searchCards(query, cards, 5, 0.8), ...searchCards(text, cards, 5, 0.8)]) {
      if ((best.get(r.card.id)?.score ?? -1) < r.score) best.set(r.card.id, r);
    }
    const scored = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    hits = scored.map((r) => r.card);
    strongCard = scored.find((r) => r.score >= STRONG_MATCH)?.card;
    laws = searchLaws(query, 4);

    const cardText = hits.length
      ? hits
          .map((c) => `[cardId=${c.id}] ${c.title}\n場面: ${c.scene}\nやり方: ${c.body}\n理由・失敗: ${c.reason}\n新人の間違い: ${c.caution}`)
          .join("\n\n")
      : "（関係する知恵カードはありません）";
    const lawText = laws.length
      ? laws.map((l) => `[lawId=${l.id}] ${l.lawName}（${l.edition}） ${l.article}【${l.heading}】\n原文:\n${l.text}`).join("\n\n")
      : "（関係する条文はありません）";

    // Calculations: the model only chooses the tool and its inputs; the numbers come from code.
    if (routed.kind === "calc" || routed.kind === "law") {
      const picked = await pickTools({
        model: MODEL_ANSWER,
        system: CALC_PICK_SYSTEM,
        user: `質問: ${text}\n（こう受け取りました: ${interpretedAs}）`,
        tools: calcTools(),
      });
      models.calc = MODEL_ANSWER;
      for (const t of picked) {
        try {
          calcs.push(runCalc(t.name, t.input));
        } catch (e) {
          if (!(e instanceof CalcInputError)) throw e;
          calcErrors.push(e.message);
        }
      }
    }
    const calcText = calcs.length
      ? calcs.map((c) => `【${c.title}】結果: ${c.verdict}\n${c.steps.join("\n")}${c.notes.length ? `\n注意: ${c.notes.join(" ")}` : ""}`).join("\n\n")
      : calcErrors.length
        ? `（計算できませんでした: ${calcErrors.join(" / ")}。足りない条件を若手に聞き返す文を general で入れる）`
        : "";

    const r = await jsonCall<{ sentences: Sentence[] }>({
      model: MODEL_ANSWER,
      system: ANSWER_SYSTEM,
      user: `質問: ${text}\n（こう受け取りました: ${interpretedAs}）\n\n${calcText ? `計算結果（プログラム）:\n${calcText}\n\n` : ""}法令・基準:\n${lawText}\n\n社内の知恵カード:\n${cardText}`,
      schema: {
        type: "object",
        properties: {
          sentences: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                source: { type: "string", enum: ["law", "wisdom", "general"] },
                cardId: { type: "string" },
                lawId: { type: "string" },
                quote: { type: "string" },
              },
              required: ["text", "source"],
              additionalProperties: false,
            },
          },
        },
        required: ["sentences"],
        additionalProperties: false,
      },
      maxTokens: 6000,
    });
    models.answer = MODEL_ANSWER;
    sentences = enforceSources(r.sentences, new Set(hits.map((c) => c.id)), new Set(laws.map((l) => l.id)));
    // The veteran's knowledge is the point of the app: if a card clearly matches but the model left it out, show it.
    if (strongCard && !sentences.some((s) => s.source === "wisdom")) {
      const at = sentences.findIndex((s) => s.source === "general");
      sentences.splice(at < 0 ? sentences.length : at, 0, { text: `${strongCard.title}。`, source: "wisdom", cardId: strongCard.id });
    }
  } else {
    hits = searchCards(text, cards, 5).map((r) => r.card);
    laws = searchLaws(text, 4);
    sentences = enforceSources(dummyAnswer(text, hits, laws), new Set(hits.map((c) => c.id)), new Set(laws.map((l) => l.id)));
  }

  const usedCardIds = [...new Set(sentences.flatMap((s) => (s.source === "wisdom" && s.cardId ? [s.cardId] : [])))];
  const usedLawIds = [...new Set(sentences.flatMap((s) => (s.source === "law" && s.lawId ? [s.lawId] : [])))];
  const grounded = usedCardIds.length > 0 || usedLawIds.length > 0 || calcs.length > 0;
  const ref = await db.collection("answers").add({
    companyId: COMPANY,
    question: text,
    interpretedAs,
    sentences,
    grounded,
    usedCardIds,
    usedLawIds,
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
    calcs,
    laws: usedLawIds.map((id) => {
      const l = getLawById(id)!;
      return { id, lawName: l.lawName, short: l.short, edition: l.edition, article: l.article, heading: l.heading, sourceUrl: l.sourceUrl };
    }),
  };
}

export async function markHelped(data: Record<string, unknown>, uid: string) {
  const answerId = str(data.answerId, "answerId", 64);
  const askerId = uid;
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
