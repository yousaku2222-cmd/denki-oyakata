// One-off: cards published before cardPrivate existed still carry, on the public card, the writer's device id
// (authorId, confirmations[].by), the real name even when it was to be hidden, and the raw interview (transcript).
// This moves them into cardPrivate and leaves the card with only what the screen shows.
// Usage (owner's machine, with Firestore admin credentials, e.g. `gcloud auth application-default login`):
//   GOOGLE_CLOUD_PROJECT=denki-oyakata node scripts/migrate-private.mjs           # dry run: prints what would change
//   GOOGLE_CLOUD_PROJECT=denki-oyakata node scripts/migrate-private.mjs --apply   # writes
// Against the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-denki-oyakata node scripts/migrate-private.mjs --apply
import { createRequire } from "node:module";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const db = getFirestore();

let changed = 0;
const snap = await db.collection("cards").get();
for (const d of snap.docs) {
  const c = d.data();
  const hidden = c.showAuthorName === false;
  const needs =
    c.authorId !== undefined ||
    (c.transcript ?? []).length > 0 ||
    (hidden && c.authorName) ||
    (c.confirmations ?? []).some((x) => x.by !== undefined || (hidden && x.name));
  if (!needs) continue;
  changed++;
  const privRef = db.collection("cardPrivate").doc(d.id);
  const priv = await privRef.get();
  const keep = {
    ...(c.authorId !== undefined && !priv.get("authorId") ? { authorId: c.authorId } : {}),
    ...(c.authorName && !priv.get("authorName") ? { authorName: c.authorName } : {}),
    ...((c.transcript ?? []).length && !(priv.get("transcript") ?? []).length ? { transcript: c.transcript } : {}),
  };
  const shown = hidden ? "" : c.authorName ?? "";
  const update = {
    authorId: FieldValue.delete(),
    transcript: [],
    authorName: shown,
    confirmations: (c.confirmations ?? []).map((x) => ({ name: hidden ? "" : x.name ?? "", at: x.at })),
  };
  console.log(`${apply ? "update" : "would update"} cards/${d.id}${hidden ? " (name hidden)" : ""}: move ${Object.keys(keep).join(", ") || "nothing"} to cardPrivate`);
  if (apply) {
    await privRef.set(keep, { merge: true });
    await d.ref.update(update);
  }
}
console.log(`${changed} of ${snap.size} cards ${apply ? "updated" : "need updating (run with --apply)"}`);
