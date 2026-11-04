import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { HttpsError } from "firebase-functions/v2/https";
import { getClient, jsonCall } from "./claude";
import { MODEL_ANSWER } from "./models";
import { displayAuthor, safetyNote, spacesOf, str } from "./common";
import { publishedCards } from "./ask";
import { LAWS, getLawById, lawLabel } from "./laws";
import { CONDUITS } from "./calc/conduitData";

// ⑤ 撮る: a photo of a part → its name, what it is for, and where to go next (the veteran's cards, the rules, a calculation).
// Small print and nameplates are cut out of the photo and enlarged, then read again: the model misreads small text
// in a full photo, and a calculation started from a misread size would be wrong.

type Verdict = "sure" | "likely" | "unknown";
interface Judged {
  verdict: Verdict;
  name: string;
  fieldNames: string[];
  use: string;
  candidates: { name: string; hint: string }[];
  printed: string;
  regions: { x: number; y: number; w: number; h: number; what: string }[];
  confusables: { name: string; diff: string }[];
  companions: string[];
  askIdeas: string[];
  searchTerms: string[];
  spec: { conduitType: string; conduitSize: number; breakerAmps: number };
  cardIds: string[];
  lawIds: string[];
}

const CONDUIT_TYPES = [...Object.keys(CONDUITS), "none"];
const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["sure", "likely", "unknown"] },
    name: { type: "string" },
    fieldNames: { type: "array", items: { type: "string" } },
    use: { type: "string" },
    candidates: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, hint: { type: "string" } }, required: ["name", "hint"], additionalProperties: false },
    },
    printed: { type: "string" },
    regions: {
      type: "array",
      items: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, what: { type: "string" } },
        required: ["x", "y", "w", "h", "what"],
        additionalProperties: false,
      },
    },
    confusables: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, diff: { type: "string" } }, required: ["name", "diff"], additionalProperties: false },
    },
    companions: { type: "array", items: { type: "string" } },
    askIdeas: { type: "array", items: { type: "string" } },
    searchTerms: { type: "array", items: { type: "string" } },
    cardIds: { type: "array", items: { type: "string" } },
    lawIds: { type: "array", items: { type: "string" } },
    spec: {
      type: "object",
      properties: { conduitType: { type: "string", enum: CONDUIT_TYPES }, conduitSize: { type: "number" }, breakerAmps: { type: "number" } },
      required: ["conduitType", "conduitSize", "breakerAmps"],
      additionalProperties: false,
    },
  },
  required: ["verdict", "name", "fieldNames", "use", "candidates", "printed", "regions", "confusables", "companions", "askIdeas", "searchTerms", "spec", "cardIds", "lawIds"],
  additionalProperties: false,
};

const SYSTEM = `電気工事の若手（資格なし〜第二種電気工事士）が現場で撮った部材・材料・工具の写真を見て、何かを答えます。言い切れない時は言い切らないこと（間違った部材で施工すると事故や手戻りになる）。
- verdict: sure=形と印字からほぼ間違いない / likely=たぶんこれだが印字や型番で確かめてほしい / unknown=決められない
- name: 正式な名前（例「合成樹脂製可とう電線管（PF管）」）。unknown なら空
- fieldNames: 現場での呼び名（例「PF」「フレキ」）。2つまで
- use: 何に使うか。若手向けに40字以内
- candidates: likely・unknown の時は候補を3つ（hint は見分け方を20字以内）。sure の時は空
- printed: 写真の中で読める印字・銘板・型番の文字をそのまま（読めなければ空）。推測で補わない
- regions: 印字・銘板・型番があるのに小さくて読み切れない所の位置（写真全体を 0〜1 とした左上x・y・幅w・高さh）。2つまで。読めた・無いなら空
- confusables: 間違えやすい部材と違い（例 PF管とCD管: CDはオレンジでコンクリート埋設専用）。2つまで、diff は40字以内
- companions: 一緒に使う物（例 PF管 → コネクタ、カップリング、サドル）。4つまで
- askIdeas: この部材の写真を撮った若手が、現場で親方に聞きそうなこと。名前や用途（もう上で答えたこと）ではなく、この現場での使い方・選び方・取り付け方の判断を聞く質問を3つ、それぞれ30字以内（例 サドル →「サドルの間隔はどれくらい？」「この管にこのサドルで合ってますか？」）。unknown なら空
- searchTerms: この部材を探す時の言葉（部材の名前・呼び名・使う場面）。5つまで
- cardIds: 下の「社内の知恵カード」のうち、この部材を扱う時に本当に役立つものの id（3つまで、無ければ空）。言葉が似ているだけのものは選ばない
- lawIds: 下の「法令・基準」のうち、この部材の選び方・施工に直接関係するものの id（3つまで）。関係が薄いものは選ばない
- spec: 電線管なら種類（VE=硬質ビニル電線管、PF=合成樹脂製可とう電線管、CD、E=ねじなし、C=薄鋼、G=厚鋼、FEP=波付硬質合成樹脂管、PLICA=金属製可とう電線管2種、違えば none）と呼び（印字で読めた時だけ、読めなければ 0）。ブレーカーなら定格電流（A、印字で読めた時だけ、ほかは 0）`;

const RECHECK = `前の判定と、写真から切り出して拡大した印字を渡します。拡大した印字を読み直して、判定を同じ形で返し直してください。印字で確かめられたら verdict を上げてよい。読めない文字は推測で補わない。regions は空にしてください。`;

const MAX_LISTED_CARDS = 80;
const MAX_IMAGE = 6_000_000; // base64 characters
const MAX_PIXELS = 40_000_000; // a 48MP phone photo is already shrunk on the device; this stops "zip bomb" images
const FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

/**
 * Checks and normalises an uploaded photo before anything expensive happens: only real photos (JPEG/PNG/WebP/HEIF),
 * within a pixel limit (sharp would otherwise decode up to 268M pixels), rotated by EXIF, long side ≤ 1568px.
 */
export async function preparePhoto(base64: string): Promise<Buffer> {
  const bad = () => new HttpsError("invalid-argument", "写真が大きすぎるか、形式が違います");
  if (!base64 || base64.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw bad();
  const buf = Buffer.from(base64, "base64");
  try {
    const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!meta.format || !FORMATS.has(meta.format) || !meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) throw bad();
    return await sharp(buf, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw bad(); // broken or unsupported data
  }
}

const imageBlock = (buf: Buffer): Anthropic.ContentBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
});

/** Cuts a region out of the photo (with a margin) and enlarges it so small print becomes readable. */
async function crop(photo: Buffer, w: number, h: number, r: Judged["regions"][number]): Promise<Buffer | null> {
  const pad = 0.2;
  const left = Math.max(0, Math.floor((r.x - r.w * pad) * w));
  const top = Math.max(0, Math.floor((r.y - r.h * pad) * h));
  const right = Math.min(w, Math.ceil((r.x + r.w * (1 + pad)) * w));
  const bottom = Math.min(h, Math.ceil((r.y + r.h * (1 + pad)) * h));
  if (right - left < 8 || bottom - top < 8) return null;
  return sharp(photo)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** The calculation to open with what was read, if any. */
function calcLink(spec: Judged["spec"]) {
  const c = CONDUITS[spec.conduitType];
  if (c) {
    const size = c.sizes[String(spec.conduitSize)] ? String(spec.conduitSize) : undefined;
    return { name: "conduit_fill", label: `${c.short}${size ?? ""}に何本入るか計算する`, params: { conduitType: spec.conduitType, ...(size ? { conduitSize: size } : {}) } };
  }
  // a branch-circuit breaker: the wire size comes from 149-1表 (20A配線用遮断器 → 1.6mm), not from ampacity in a conduit
  if (Number.isInteger(spec.breakerAmps) && spec.breakerAmps > 0 && spec.breakerAmps <= 50) {
    return { name: "branch_wire", label: `${spec.breakerAmps}Aのブレーカーの回路に要る電線の太さを見る`, params: { amps: spec.breakerAmps, breakerKind: "mccb" } };
  }
  return null;
}

export async function identifyPart(data: Record<string, unknown>, uid: string) {
  const image = typeof data.image === "string" ? data.image.replace(/^data:image\/\w+;base64,/, "") : "";
  const name = image ? "" : str(data.name, "部材の名前", 60);
  // check (and shrink) the photo before any Claude call
  const photo = image && getClient() ? await preparePhoto(image) : null;
  if (image && !photo && (image.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+={0,2}$/.test(image))) throw new HttpsError("invalid-argument", "写真が大きすぎるか、形式が違います");

  // Claude picks the related cards and rules from these lists; the ids are checked against the data afterwards.
  const all = await publishedCards(spacesOf(data, uid));
  // The list goes into every photo request: keep it bounded however many cards there are (most helpful first).
  const listed = [...all]
    .sort((a, b) => b.helpedCount - a.helpedCount || (b.publishedAt?.toMillis() ?? 0) - (a.publishedAt?.toMillis() ?? 0))
    .slice(0, MAX_LISTED_CARDS);
  const catalog = ["社内の知恵カード:", ...listed.map((c) => `[${c.id}] ${c.title.slice(0, 40)}`), "法令・基準:", ...LAWS.map((l) => `[${l.id}] ${lawLabel(l)}`)].join("\n");
  const judge = (content: Anthropic.ContentBlockParam[]) =>
    jsonCall<Judged>({ model: MODEL_ANSWER, system: `${SYSTEM}\n\n${catalog}`, user: content, schema: SCHEMA, maxTokens: 6000 });
  let j: Judged;
  let zoomed = 0;
  if (!getClient()) {
    j = {
      verdict: "likely",
      name: name || "合成樹脂製可とう電線管（PF管）",
      fieldNames: ["PF"],
      use: "（ダミー）APIキーが無いので、例を表示しています",
      candidates: [],
      printed: "",
      regions: [],
      confusables: [],
      companions: [],
      askIdeas: ["PF管の支持の間隔はどれくらい？", "この場所でPF管を使って大丈夫ですか？", "ボックスとのつなぎ方で合ってますか？"],
      searchTerms: ["PF管"],
      spec: { conduitType: "PF", conduitSize: 22, breakerAmps: 0 },
      cardIds: [],
      lawIds: ["kaishaku-158"],
    };
  } else if (photo) {
    const meta = await sharp(photo).metadata();
    j = await judge([imageBlock(photo), { type: "text", text: "この写真の部材は何ですか。" }]);
    // keep each crop with its own label (a skipped region must not shift the labels of the next)
    const crops = (await Promise.all(j.regions.slice(0, 2).map(async (r) => ({ buf: await crop(photo, meta.width ?? 0, meta.height ?? 0, r), what: r.what }))))
      .flatMap((c) => (c.buf ? [{ buf: c.buf, what: c.what }] : []));
    if (crops.length) {
      zoomed = crops.length;
      j = await judge([
        imageBlock(photo),
        ...crops.flatMap((c, i) => [{ type: "text" as const, text: `拡大した印字${i + 1}（${c.what}）:` }, imageBlock(c.buf)]),
        { type: "text", text: `${RECHECK}\n前の判定: ${JSON.stringify({ ...j, regions: [] })}` },
      ]);
    }
  } else {
    j = await judge([{ type: "text", text: `若手が候補から「${name}」を選びました。写真は無いので、この部材について答えてください（verdict は sure、printed と regions は空、spec は分かる範囲で）。` }]);
  }

  // keep only ids that really exist
  const byId = new Map(listed.map((c) => [c.id, c]));
  const cards = [...new Set(j.cardIds)]
    .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    .slice(0, 3)
    .map((c) => ({ id: c.id, title: c.title, body: c.body, reason: c.reason, caution: c.caution, author: displayAuthor(c) }));
  const laws = [...new Set(j.lawIds)]
    .flatMap((id) => {
      const l = getLawById(id);
      return l ? [{ id: l.id, label: lawLabel(l), summary: l.summary }] : [];
    })
    .slice(0, 3);
  return {
    verdict: j.verdict,
    name: j.name,
    fieldNames: j.fieldNames.slice(0, 2),
    use: j.use,
    candidates: j.verdict === "sure" ? [] : j.candidates.slice(0, 3),
    printed: j.printed,
    zoomed,
    confusables: j.confusables.slice(0, 2),
    companions: j.companions.slice(0, 4),
    // questions for the veteran that fit this part (the general ones on the screen do not: 「つなぎ方」 for a saddle)
    askIdeas: j.verdict === "unknown" ? [] : (j.askIdeas ?? []).filter((x) => typeof x === "string" && x.trim() && x.length <= 40).slice(0, 3),
    cards,
    laws,
    calc: calcLink(j.spec),
    safetyNote: safetyNote(`${j.name} ${j.use}`),
    model: getClient() ? MODEL_ANSWER : "dummy",
  };
}
