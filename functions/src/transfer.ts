import { randomInt } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { COMPANY, db, str } from "./common";
import { takeQuota } from "./limits";

// Moving to a new phone (or after the browser's data was cleared): there is no login, so the old device
// shows a one-time code and the new device enters it. Everything owned by the old device id moves over.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
const CODE_LENGTH = 10; // 31^10 ≈ 8×10^14, and tries are capped per day
const TTL_MS = 24 * 3600_000;

export const newCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const normalizeCode = (s: string) => s.normalize("NFKC").toUpperCase().replace(/[^0-9A-Z]/g, "");

export async function makeTransferCode(_data: Record<string, unknown>, uid: string) {
  const code = newCode();
  await db.collection("transfers").doc(code).set({ uid, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS) });
  return { code, expiresInHours: TTL_MS / 3600_000 };
}

/** Rewrites one field from `from` to `to` on every matching document, in batches. */
async function move(collection: string, field: string, from: string, to: string, extra: (d: FirebaseFirestore.DocumentData) => Record<string, unknown> = () => ({})) {
  const snap = await db.collection(collection).where("companyId", "==", COMPANY).where(field, "==", from).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) batch.update(d.ref, { [field]: to, ...extra(d.data()) });
    await batch.commit();
  }
  return snap.size;
}

export async function useTransferCode(data: Record<string, unknown>, uid: string, ctx?: { ip: string }) {
  await takeQuota(uid, "transfer", ctx?.ip); // a few tries a day, so codes cannot be guessed
  const code = normalizeCode(str(data.code, "code", 20));
  const ref = db.collection("transfers").doc(code);
  const from = await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists || (t.get("expiresAt") as Timestamp).toMillis() < Date.now()) throw new HttpsError("not-found", "引き継ぎコードが違うか、期限（24時間）が切れています。");
    const old = t.get("uid") as string;
    if (old === uid) throw new HttpsError("failed-precondition", "このコードは、この端末で出したものです。新しい端末で入れてください。");
    tx.delete(ref); // one use only
    return old;
  });
  const cards = await move("cards", "authorId", from, uid, (d) => ({
    confirmations: ((d.confirmations ?? []) as { by: string }[]).map((c) => (c.by === from ? { ...c, by: uid } : c)),
  }));
  const privSnap = await db.collection("cardPrivate").where("authorId", "==", from).get();
  for (const d of privSnap.docs) await d.ref.update({ authorId: uid });
  const questions = await move("questions", "askerId", from, uid, (d) => (d.excludeVeteranId === from ? { excludeVeteranId: uid } : {}));
  await move("answers", "askerId", from, uid);
  const user = await db.collection("users").doc(from).get();
  if (user.exists) await db.collection("users").doc(uid).set(user.data()!, { merge: true });
  return { cards, questions };
}
