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
