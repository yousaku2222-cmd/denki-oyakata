import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COMPANY, db, str } from "./common";
import { takeQuota } from "./limits";

export async function sendToBox(data: Record<string, unknown>, uid: string, ctx?: { ip: string }) {
  const text = str(data.text, "text", 500);
  const askerId = uid;
  const askerName = str(data.askerName, "askerName", 30, false) || "若手";
  const askerRole = data.askerRole === "veteran" ? "veteran" : "young";
  // a small JPEG from ⑤撮る ("これ何ですか？"); kept in the question itself, so no storage bucket is needed
  const photo = typeof data.photo === "string" ? data.photo : "";
  if (photo && (photo.length > 300_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo))) throw new HttpsError("invalid-argument", "写真が大きすぎるか、形式が違います");
  // No Claude here, but every veteran's device downloads the open questions (photos included): cap the posts too.
  await takeQuota(askerId, "box", ctx?.ip);
  const ref = await db.collection("questions").add({
    companyId: COMPANY,
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
}

export async function markGoodQuestion(data: Record<string, unknown>, uid: string) {
  const questionId = str(data.questionId, "questionId", 64);
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
export async function openQuestions(_data: Record<string, unknown>, uid: string) {
  // only the small fields: the photos (up to 300KB each) stay in Firestore until one is opened
  const snap = await db
    .collection("questions")
    .where("companyId", "==", COMPANY)
    .where("status", "==", "open")
    .select("text", "askerName", "askerRole", "excludeVeteranId", "goodBy", "createdAt", "hasPhoto")
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
      createdAt: ms(d.get("createdAt")),
    })),
  };
}

/** The photo of one question, when the veteran opens it. */
export async function questionPhoto(data: Record<string, unknown>) {
  const q = await db.collection("questions").doc(str(data.questionId, "questionId", 64)).get();
  if (!q.exists || q.get("companyId") !== COMPANY) throw new HttpsError("not-found", "質問が見つかりません。");
  return { photo: (q.get("photo") as string | null) || null };
}

/** The questions this device asked, and the card that answered each. */
export async function myQuestions(_data: Record<string, unknown>, uid: string) {
  const snap = await db.collection("questions").where("companyId", "==", COMPANY).where("askerId", "==", uid).get();
  const cardIds = [...new Set(snap.docs.map((d) => d.get("answeredCardId") as string | null).filter((x): x is string => !!x))];
  const cards = cardIds.length ? await db.getAll(...cardIds.map((id) => db.collection("cards").doc(id))) : [];
  const title = new Map(cards.map((c) => [c.id, c.exists && c.get("status") === "published" ? (c.get("title") as string) : "（いまは非公開のカード）"]));
  return {
    questions: snap.docs
      .map((d) => ({
        id: d.id,
        text: d.get("text") as string,
        status: d.get("status") as "open" | "answered",
        answeredCardTitle: d.get("answeredCardId") ? (title.get(d.get("answeredCardId")) ?? null) : null,
        createdAt: ms(d.get("createdAt")),
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}
