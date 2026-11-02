import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COMPANY, db, str } from "./common";

export async function sendToBox(data: Record<string, unknown>, uid: string) {
  const text = str(data.text, "text", 500);
  const askerId = uid;
  const askerName = str(data.askerName, "askerName", 30, false) || "若手";
  const askerRole = data.askerRole === "veteran" ? "veteran" : "young";
  const ref = await db.collection("questions").add({
    companyId: COMPANY,
    text,
    askerId,
    askerName,
    askerRole,
    // A veteran's own question goes to the other veterans, not to themselves.
    excludeVeteranId: askerRole === "veteran" ? askerId : null,
    photoUrl: null,
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
  await ref.update({ goodBy: FieldValue.arrayUnion(veteranId) });
  return { ok: true };
}
