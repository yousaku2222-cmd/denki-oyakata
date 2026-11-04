import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, displayAuthor, spaceOf, spacesOf, str, type CardDoc } from "./common";
import { takeQuota } from "./limits";
import { normalizeQuestion } from "./ask";

export async function sendToBox(data: Record<string, unknown>, uid: string, ctx?: { ip: string }) {
  const text = str(data.text, "質問", 500);
  const askerId = uid;
  const askerName = str(data.askerName, "呼び名", 30, false) || "若手";
  const askerRole = data.askerRole === "veteran" ? "veteran" : "young";
  // a small JPEG from ⑤撮る ("これ何ですか？"); kept in the question itself, so no storage bucket is needed
  const photo = typeof data.photo === "string" ? data.photo : "";
  if (photo && (photo.length > 300_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo))) throw new HttpsError("invalid-argument", "写真が大きすぎるか、形式が違います");
  // what ⑤撮る's AI took the part for, so the veteran sees the question the way the young worker saw it
  const photoPart = photo ? str(data.photoPart, "写真の部材", 80, false) : "";
  // No Claude here, but every veteran's device downloads the open questions (photos included): cap the posts too.
  await takeQuota(askerId, "box", ctx?.ip);
  const companyId = spaceOf(data, uid); // 審査員モードなら本人にだけ見える
  // The same words (spaces and a closing ？ aside) still open in the box: one question, asked by several people.
  // Photo questions are never merged: the photo is the question.
  // A follow-up (from わたし, under an answer a veteran gave): it carries the earlier question and its card, so the
  // veteran knows what was already said. Only the one who asked (or joined) that question can follow it up.
  const followUpOf = str(data.followUpOf, "前の質問の番号", 64, false);
  let followUp: { questionId: string; text: string; cardTitle: string | null } | null = null;
  if (followUpOf) {
    const prev = await db.collection("questions").doc(followUpOf).get();
    const mine = prev.exists && (prev.get("askerId") === uid || ((prev.get("alsoAskerIds") as string[] | undefined) ?? []).includes(uid));
    if (!mine || prev.get("companyId") !== companyId) throw new HttpsError("not-found", "前の質問が見つかりません。");
    const cardId = prev.get("answeredCardId") as string | null;
    const card = cardId ? await db.collection("cards").doc(cardId).get() : null;
    followUp = { questionId: prev.id, text: prev.get("text") as string, cardTitle: card?.exists && card.get("status") === "published" ? (card.get("title") as string) : null };
  }
  // Follow-ups are never merged either: the same words after a different answer are a different question.
  const textKey = photo || followUp ? null : normalizeQuestion(text);
  return db.runTransaction(async (tx) => {
    if (textKey) {
      const same = await tx.get(
        db.collection("questions").where("companyId", "==", companyId).where("status", "==", "open").where("textKey", "==", textKey).limit(1),
      );
      const q = same.docs[0];
      if (q) {
        if (q.get("askerId") === askerId || ((q.get("alsoAskerIds") as string[] | undefined) ?? []).includes(askerId)) {
          return { questionId: q.id, duplicate: true as const }; // already in the box from this device
        }
        // someone new asking it brings it back up as 新着 in the box
        // (a veteran who joins is remembered, so the question is not put in their own box if it passes to them)
        tx.update(q.ref, { alsoAskerIds: FieldValue.arrayUnion(askerId), lastAskedAt: Timestamp.now(), ...(askerRole === "veteran" ? { veteranAskerIds: FieldValue.arrayUnion(askerId) } : {}) });
        return { questionId: q.id, merged: true as const, askers: 2 + ((q.get("alsoAskerIds") as string[] | undefined) ?? []).length };
      }
    }
    const ref = db.collection("questions").doc();
    tx.set(ref, {
      companyId,
      textKey,
      alsoAskerIds: [], // others who sent the same question (they hear the answer too)
      text,
      askerId,
      askerName,
      askerRole,
      // A veteran's own question goes to the other veterans, not to themselves.
      excludeVeteranId: askerRole === "veteran" ? askerId : null,
      photoUrl: null,
      photo: photo || null,
      hasPhoto: !!photo, // so the list can say so without reading the photo
      photoPart: photoPart || null,
      followUp,
      status: "open",
      goodBy: [],
      answeredCardId: null,
      createdAt: Timestamp.now(),
      lastAskedAt: Timestamp.now(),
      answeredAt: null,
    });
    return { questionId: ref.id };
  });
}

export async function markGoodQuestion(data: Record<string, unknown>, uid: string) {
  const questionId = str(data.questionId, "質問の番号", 64);
  const veteranId = uid;
  const ref = db.collection("questions").doc(questionId);
  const q = await ref.get();
  if (!q.exists) throw new HttpsError("not-found", "question not found");
  if (q.get("askerId") === veteranId) throw new HttpsError("failed-precondition", "自分の質問には押せません。");
  await ref.update({ goodBy: FieldValue.arrayUnion(veteranId) });
  return { ok: true };
}

// The question box is read through these calls, not straight from Firestore: a question carries its asker's
// device id and a photo, and every veteran's phone would otherwise download all of them.
const BOX_LIST = 50;
const ms = (t: Timestamp | null | undefined) => t?.toMillis() ?? 0;

/** Open questions for a veteran (newest first, without photos; not the veteran's own). */
export async function openQuestions(data: Record<string, unknown>, uid: string) {
  // only the small fields: the photos (up to 300KB each) stay in Firestore until one is opened
  const snap = await db
    .collection("questions")
    .where("companyId", "in", spacesOf(data, uid))
    .where("status", "==", "open")
    .select("text", "askerName", "askerRole", "excludeVeteranId", "goodBy", "alsoAskerIds", "createdAt", "hasPhoto", "photoPart", "followUp", "lastAskedAt")
    .get();
  const lastAsked = (d: FirebaseFirestore.QueryDocumentSnapshot) => ms(d.get("lastAskedAt")) || ms(d.get("createdAt"));
  const list = snap.docs.filter((d) => d.get("excludeVeteranId") !== uid).sort((a, b) => lastAsked(b) - lastAsked(a));
  return {
    more: Math.max(0, list.length - BOX_LIST),
    questions: list.slice(0, BOX_LIST).map((d) => ({
      id: d.id,
      text: d.get("text") as string,
      askerName: (d.get("askerName") as string) || "若手",
      askerRole: d.get("askerRole") as string,
      hasPhoto: d.get("hasPhoto") !== false, // questions from before the flag: offer to look
      photoPart: (d.get("photoPart") as string | null | undefined) ?? null,
      good: ((d.get("goodBy") as string[] | undefined) ?? []).includes(uid),
      askers: 1 + ((d.get("alsoAskerIds") as string[] | undefined) ?? []).length,
      // the earlier question and the card that answered it (no ids of people)
      followUp: (() => {
        const f = d.get("followUp") as { text: string; cardTitle: string | null } | null | undefined;
        return f ? { text: f.text, cardTitle: f.cardTitle } : null;
      })(),
      createdAt: ms(d.get("createdAt")),
      lastAskedAt: lastAsked(d), // when someone last sent it (the first time, or joining it)
    })),
  };
}

/** The photo of one question, when the veteran opens it. */
export async function questionPhoto(data: Record<string, unknown>, uid: string) {
  const q = await db.collection("questions").doc(str(data.questionId, "質問の番号", 64)).get();
  if (!q.exists || !spacesOf(data, uid).includes(q.get("companyId") as string)) throw new HttpsError("not-found", "質問が見つかりません。");
  return { photo: (q.get("photo") as string | null) || null, photoPart: (q.get("photoPart") as string | null | undefined) ?? null };
}

/** The questions this device asked, and the card that answered each. */
export async function myQuestions(data: Record<string, unknown>, uid: string) {
  const spaces = spacesOf(data, uid);
  const [mine, joined] = await Promise.all([
    db.collection("questions").where("companyId", "in", spaces).where("askerId", "==", uid).get(),
    // one field only (no composite index): the space is checked below
    db.collection("questions").where("alsoAskerIds", "array-contains", uid).get(),
  ]);
  const docs = [...mine.docs, ...joined.docs.filter((d) => spaces.includes(d.get("companyId")))].filter((d) => d.get("status") !== "withdrawn");
  const snap = { docs };
  const cardIds = [...new Set(snap.docs.map((d) => d.get("answeredCardId") as string | null).filter((x): x is string => !!x))];
  const cards = cardIds.length ? await db.getAll(...cardIds.map((id) => db.collection("cards").doc(id))) : [];
  const shown = (c: (typeof cards)[number]) => c.exists && c.get("status") === "published";
  const title = new Map(cards.map((c) => [c.id, shown(c) ? (c.get("title") as string) : "（いまは非公開のカード）"]));
  // who answered, as the card shows it (a hidden name stays hidden)
  const author = new Map(cards.map((c) => [c.id, shown(c) ? displayAuthor(c.data() as CardDoc) : null]));
  return {
    questions: snap.docs
      .map((d) => ({
        id: d.id,
        text: d.get("text") as string,
        status: d.get("status") as "open" | "answered",
        answeredCardTitle: d.get("answeredCardId") ? (title.get(d.get("answeredCardId")) ?? null) : null,
        answeredBy: d.get("answeredCardId") ? (author.get(d.get("answeredCardId")) ?? null) : null,
        hasPhoto: !!d.get("hasPhoto"),
        followUp: (() => {
          const f = d.get("followUp") as { text: string; cardTitle: string | null } | null | undefined;
          return f ? { text: f.text, cardTitle: f.cardTitle } : null;
        })(),
        good: ((d.get("goodBy") as string[] | undefined) ?? []).length, // veterans who said いい質問
        askers: 1 + ((d.get("alsoAskerIds") as string[] | undefined) ?? []).length,
        createdAt: ms(d.get("createdAt")),
        answeredAt: ms(d.get("answeredAt")),
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

/**
 * 話す: what to start from. Questions the young asked lately that no wisdom card answered (the words only, no ids of
 * people), newest first; a question some answer did use a card for is already covered.
 */
// The box and 話す ask for these each time they open: one read of the answers per space every few minutes is enough.
const SEEDS_FOR_MS = 3 * 60_000;
const seedsMemo = new Map<string, { at: number; questions: string[] }>();

export async function talkSeeds(data: Record<string, unknown>, uid: string) {
  const spaces = spacesOf(data, uid);
  const memoKey = spaces.join("|");
  const kept = seedsMemo.get(memoKey);
  if (kept && Date.now() - kept.at < SEEDS_FOR_MS) return { questions: kept.questions };
  const questions = await readSeeds(spaces);
  if (seedsMemo.size > 500) seedsMemo.clear(); // judges' spaces are one per device
  seedsMemo.set(memoKey, { at: Date.now(), questions });
  return { questions };
}

async function readSeeds(spaces: string[]) {
  // newest answers across spaces (one field, so no composite index), then this caller's spaces only
  const snap = await db.collection("answers").orderBy("createdAt", "desc").limit(300).select("companyId", "question", "usedCardIds", "askerRole").get();
  const covered = new Set<string>();
  const open: { key: string; text: string }[] = [];
  for (const d of snap.docs) {
    if (!spaces.includes(d.get("companyId") as string) || d.get("askerRole") === "veteran") continue;
    const text = ((d.get("question") as string | undefined) ?? "").trim();
    if (!text || text.length > 80) continue;
    const key = normalizeQuestion(text);
    if (((d.get("usedCardIds") as string[] | undefined) ?? []).length) covered.add(key);
    else if (!open.some((o) => o.key === key)) open.push({ key, text });
  }
  return open.filter((o) => !covered.has(o.key)).slice(0, 3).map((o) => o.text);
}

/**
 * わたし: take back a question no veteran has answered yet. Only one who asked it can; when others joined it, the
 * question stays for them and only the caller leaves it. A withdrawn question leaves the box and its photo is dropped.
 */
export async function withdrawQuestion(data: Record<string, unknown>, uid: string) {
  const ref = db.collection("questions").doc(str(data.questionId, "質問の番号", 64));
  const spaces = spacesOf(data, uid);
  return db.runTransaction(async (tx) => {
    const q = await tx.get(ref);
    if (!q.exists || !spaces.includes(q.get("companyId") as string)) throw new HttpsError("not-found", "質問が見つかりません。");
    const also = (q.get("alsoAskerIds") as string[] | undefined) ?? [];
    const mine = q.get("askerId") === uid;
    if (!mine && !also.includes(uid)) throw new HttpsError("permission-denied", "自分が聞いた質問だけ取り下げられます。");
    if (q.get("status") === "withdrawn") throw new HttpsError("failed-precondition", "この質問は、もう取り下げてあります。");
    if (q.get("status") !== "open") throw new HttpsError("failed-precondition", "答えが届いた質問は取り下げられません。");
    if (!mine) {
      tx.update(ref, { alsoAskerIds: FieldValue.arrayRemove(uid), veteranAskerIds: FieldValue.arrayRemove(uid) });
      return { withdrawn: false };
    }
    if (also.length) {
      // the next one who joined becomes the one who asked (their name is not known here); a veteran's own question
      // stays out of their own box
      const [next, ...rest] = also;
      const veteran = ((q.get("veteranAskerIds") as string[] | undefined) ?? []).includes(next);
      tx.update(ref, {
        askerId: next,
        askerName: veteran ? "ベテラン" : "若手",
        askerRole: veteran ? "veteran" : "young",
        excludeVeteranId: veteran ? next : null,
        alsoAskerIds: rest,
        veteranAskerIds: FieldValue.arrayRemove(next),
      });
      return { withdrawn: false };
    }
    tx.update(ref, { status: "withdrawn", photo: null, withdrawnAt: Timestamp.now() });
    return { withdrawn: true };
  });
}
