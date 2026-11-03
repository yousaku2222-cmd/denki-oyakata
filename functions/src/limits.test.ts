import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, PER_USER_PER_DAY, QuotaKind, takeQuota, today } from "./limits";

test("the day changes at midnight Japan time", () => {
  assert.equal(today(Date.parse("2026-11-03T14:59:59Z")), "2026-11-03"); // 23:59:59 JST
  assert.equal(today(Date.parse("2026-11-03T15:00:00Z")), "2026-11-04"); // 00:00 JST
});

// The rest needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };
// a day of its own for every run, so earlier runs cannot fill the counts
const day = () => Date.parse("2100-01-01T00:00:00Z") + Math.floor(Math.random() * 1e6) * 86_400_000;

async function attempt(n: number, f: (i: number) => Promise<void>) {
  let ok = 0, limited = 0;
  const other: string[] = [];
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      f(i).then(
        () => ok++,
        (e) => ((e as { code?: string }).code === "resource-exhausted" ? limited++ : other.push(String(e))),
      ),
    ),
  );
  return { ok, limited, other };
}

test("one device gets exactly its daily cap", emu, async () => {
  const now = day();
  let ok = 0;
  for (let i = 0; i < PER_USER_PER_DAY + 5; i++) await takeQuota("device-a", "claude", "", now).then(() => ok++, () => undefined);
  assert.equal(ok, PER_USER_PER_DAY);
});

test("a burst of parallel calls never passes more than the cap, and fails cleanly", emu, async () => {
  const now = day();
  const r = await attempt(PER_USER_PER_DAY + 30, () => takeQuota("device-b", "claude", "", now));
  assert.ok(r.ok <= PER_USER_PER_DAY, `ok=${r.ok}`);
  assert.deepEqual(r.other, []); // no lock timeouts, only resource-exhausted
});

test("new anonymous accounts on the same connection share the per-address cap", emu, async () => {
  const now = day();
  const kind: QuotaKind = "box";
  let ok = 0;
  for (let i = 0; i < CAPS.box.ip + 10; i++) await takeQuota(`fresh-${i}`, kind, "203.0.113.7", now).then(() => ok++, () => undefined);
  assert.equal(ok, CAPS.box.ip);
});

test("the overall cap holds across many devices and addresses, with no lock-timeout failures", emu, async () => {
  const now = day();
  const all = CAPS.publish.all;
  let ok = 0;
  for (let b = 0; b < 6; b++) {
    const r = await attempt(25, (i) => takeQuota(`u${b}-${i}`, "publish", `198.51.100.${b * 25 + i}`, now));
    assert.deepEqual(r.other, []);
    ok += r.ok;
  }
  // never over; near the end, racing calls may both be refused
  assert.ok(ok <= all && ok >= all - 25, `ok=${ok}`);
});
