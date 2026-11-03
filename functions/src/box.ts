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
  // No Claude here, but every veteran's device downloads the open questions (photos included): cap the posts too.
  await takeQuota(askerId, "box", ctx?.ip);
  const companyId = spaceOf(data, uid); // 審査員モードなら本人にだけ見える
  // The same words (spaces and a closing ？ aside) still open in the box: one question, asked by several people.
  // Photo questions are never merged: the photo is the question.
  const textKey = photo ? null : normalizeQuestion(text);
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
        tx.update(q.ref, { alsoAskerIds: FieldValue.arrayUnion(askerId) });
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
      status: "open",
      goodBy: [],
      answeredCardId: null,
      createdAt: Timestamp.now(),
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
    .select("text", "askerName", "askerRole", "excludeVeteranId", "goodBy", "alsoAskerIds", "createdAt", "hasPhoto")
    .get();
  const list = snap.docs
    .filter((d) => d.get("excludeVeteranId") !== uid)
    .sort((a, b) => ms(b.get("createdAt")) - ms(a.get("createdAt")));
  return {
    more: Math.max(0, list.length - BOX_LIST),
    questions: list.slice(0, BOX_LIST).map((d) => ({
      id: d.id,
      text: d.get("text") as string,
      askerName: (d.get("askerName") as string) || "若手",
      askerRole: d.get("askerRole") as string,
      hasPhoto: d.get("hasPhoto") !== false, // questions from before the flag: offer to look
      good: ((d.get("goodBy") as string[] | undefined) ?? []).includes(uid),
      askers: 1 + ((d.get("alsoAskerIds") as string[] | undefined) ?? []).length,
      createdAt: ms(d.get("createdAt")),
    })),
  };
}

/** The photo of one question, when the veteran opens it. */
export async function questionPhoto(data: Record<string, unknown>, uid: string) {
  const q = await db.collection("questions").doc(str(data.questionId, "質問の番号", 64)).get();
  if (!q.exists || !spacesOf(data, uid).includes(q.get("companyId") as string)) throw new HttpsError("not-found", "質問が見つかりません。");
  return { photo: (q.get("photo") as string | null) || null };
}

/** The questions this device asked, and the card that answered each. */
export async function myQuestions(data: Record<string, unknown>, uid: string) {
  const spaces = spacesOf(data, uid);
  const [mine, joined] = await Promise.all([
    db.collection("questions").where("companyId", "in", spaces).where("askerId", "==", uid).get(),
    // one field only (no composite index): the space is checked below
    db.collection("questions").where("alsoAskerIds", "array-contains", uid).get(),
  ]);
  const docs = [...mine.docs, ...joined.docs.filter((d) => spaces.includes(d.get("companyId")))];
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
        good: ((d.get("goodBy") as string[] | undefined) ?? []).length, // veterans who said いい質問
        askers: 1 + ((d.get("alsoAskerIds") as string[] | undefined) ?? []).length,
        createdAt: ms(d.get("createdAt")),
        answeredAt: ms(d.get("answeredAt")),
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}
