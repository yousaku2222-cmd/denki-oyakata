import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { preparePhoto } from "./photo";

const b64 = (b: Buffer) => b.toString("base64");

test("a normal photo is rotated and shrunk to 1568px", async () => {
  const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#888" } }).jpeg().toBuffer();
  const out = await sharp(await preparePhoto(b64(jpg))).metadata();
  assert.equal(out.format, "jpeg");
  assert.equal(Math.max(out.width!, out.height!), 1568);
});

test("broken data, SVG and non-base64 text are refused as bad input", async () => {
  await assert.rejects(preparePhoto(b64(Buffer.from("not an image"))), /invalid-argument|形式/);
  await assert.rejects(preparePhoto(b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))), /形式/);
  await assert.rejects(preparePhoto("@@@@"), /形式/);
});

test("a tiny file with a huge pixel count (decompression bomb) is refused before decoding", async () => {
  const bomb = await sharp({ create: { width: 10000, height: 10000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(bomb.length < 1_000_000); // small upload, 100M pixels
  await assert.rejects(preparePhoto(b64(bomb)), /形式/);
});
