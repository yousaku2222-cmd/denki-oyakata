// Builds functions/data/laws.source.json: the original text of each article we use, split per article.
// Usage: node scripts/laws/build-source.mjs <kaishaku.txt> <shiyo.txt>
//   kaishaku.txt: pdftotext -enc UTF-8 of 電気設備の技術基準の解釈 (R7.11.20改正)
//   shiyo.txt:    pdftotext -enc UTF-8 of 公共建築工事標準仕様書（電気設備工事編）令和7年版
// e-Gov articles are fetched from the e-Gov 法令API v2 (no key needed).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [kaishakuPath, shiyoPath] = process.argv.slice(2);
if (!kaishakuPath || !shiyoPath) throw new Error("usage: build-source.mjs <kaishaku.txt> <shiyo.txt>");

const KAISHAKU = {
  lawName: "電気設備の技術基準の解釈",
  short: "電技解釈",
  edition: "令和7年11月20日改正",
  sourceUrl: "https://www.meti.go.jp/policy/safety_security/industrial_safety/law/kijyunkaisyaku.html",
  articles: [17, 29, 36, 120, 142, 143, 144, 145, 146, 147, 148, 149, 156, 157, 158, 159, 160, 161, 164, 165, 167, 168],
};
const SHIYO = {
  lawName: "公共建築工事標準仕様書（電気設備工事編）",
  short: "標準仕様書",
  edition: "令和7年版",
  sourceUrl: "https://www.mlit.go.jp/gobuild/gobuild_tk2_000017.html",
  // 第2編 第1章: 金属管・PF/CD管・硬質ビニル管・金属製可とう電線管・ケーブル配線
  sections: ["第 2 節 金属管配線", "第 3 節 合成樹脂管配線（PF 管、CD 管）", "第 4 節 合成樹脂管配線（硬質ビニル管）", "第 5 節 金属製可とう電線管配線", "第 10 節 ケーブル配線"],
  end: "第 11 節 架空配線",
};
const EGOV = [
  { lawId: "335AC0000000139", short: "電気工事士法", articles: ["2", "3"] },
  { lawId: "335CO0000000260", short: "電気工事士法施行令", articles: ["1"] },
  { lawId: "335M50000400097", short: "電気工事士法施行規則", articles: ["2", "2_2", "2_3"] },
  { lawId: "409M50000400052", short: "電技省令", articles: ["58"] },
  { lawId: "331CO0000000273", short: "建設業法施行令", articles: ["2", "27"] },
];

const isNoise = (l) => /^\s*\d+\s*$/.test(l) || /^\f/.test(l) || l.includes("公共建築工事標準仕様書（電気設備工事編）令和７年版") || l.trim() === "国土交通省大臣官房官庁営繕部";
const clean = (lines) =>
  lines
    .map((l) => l.replace(/\f/g, ""))
    .filter((l) => !isNoise(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function kaishaku() {
  const lines = readFileSync(kaishakuPath, "utf8").replace(/\f/g, "").split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i].match(/^【(.+?)】/);
    const a = lines[i + 1].match(/^第(\d+)条(?:の(\d+))? /);
    if (h && a) starts.push({ i, heading: h[1], num: Number(a[1]), sub: a[2] });
  }
  const out = [];
  for (const n of KAISHAKU.articles) {
    const k = starts.findIndex((s) => s.num === n && !s.sub);
    if (k < 0) throw new Error(`解釈 第${n}条 not found`);
    const s = starts[k];
    const text = clean(lines.slice(s.i + 1, starts[k + 1]?.i ?? lines.length));
    out.push({ id: `kaishaku-${n}`, lawName: KAISHAKU.lawName, short: KAISHAKU.short, edition: KAISHAKU.edition, article: `第${n}条`, heading: s.heading, text, sourceUrl: KAISHAKU.sourceUrl });
  }
  return out;
}

function shiyo() {
  const lines = readFileSync(shiyoPath, "utf8").replace(/\f/g, "").split(/\r?\n/);
  const out = [];
  for (const sec of SHIYO.sections) {
    const from = lines.indexOf(sec);
    if (from < 0) throw new Error(`${sec} not found`);
    let to = from + 1;
    while (to < lines.length && !/^第 \d+ 節 /.test(lines[to])) to++;
    const body = lines.slice(from + 1, to);
    const heads = body.flatMap((l, i) => (/^\d+\.\d+\.\d+ \S/.test(l) ? [i] : []));
    heads.forEach((h, j) => {
      const [num, ...title] = body[h].split(" ");
      const text = clean(body.slice(h + 1, heads[j + 1] ?? body.length));
      if (text.length < 60) return; // skip one-line cross references ("第13節による")
      out.push({
        id: `shiyo-${num}`,
        lawName: SHIYO.lawName,
        short: SHIYO.short,
        edition: SHIYO.edition,
        article: num,
        heading: `${sec.replace(/^第 (\d+) 節 /, "")} ${title.join(" ")}`,
        text,
        sourceUrl: SHIYO.sourceUrl,
      });
    });
    if (sec === SHIYO.sections.at(-1) && lines.indexOf(SHIYO.end) < 0) throw new Error("end marker missing");
  }
  return out;
}

// e-Gov returns a tree; flatten it to text with a line per paragraph / item.
function flatten(node) {
  if (typeof node === "string") return node;
  const inner = (node.children ?? []).map(flatten).join("");
  if (["ArticleCaption", "ArticleTitle", "Rt"].includes(node.tag)) return ""; // Rt = ruby reading
  if (["Paragraph", "Item", "Subitem1", "Subitem2"].includes(node.tag)) return `\n${inner}`;
  if (["ParagraphNum", "ItemTitle", "Subitem1Title", "Subitem2Title"].includes(node.tag)) return inner ? `${inner} ` : "";
  if (node.tag === "TableRow") return `
${inner}`;
  if (node.tag === "TableColumn") return `${inner}｜`;
  return inner;
}
const toKanjiArticle = (a) => `第${a.replace("_", "条の").replace(/^(\d+)$/, "$1")}${a.includes("_") ? "" : "条"}`;

async function egov() {
  const out = [];
  for (const law of EGOV) {
    for (const a of law.articles) {
      const url = `https://laws.e-gov.go.jp/api/2/law_data/${law.lawId}?response_format=json&elm=MainProvision-Article_${a}`;
      const j = await (await fetch(url)).json();
      const art = j.law_full_text;
      const caption = (art.children.find((c) => c.tag === "ArticleCaption")?.children ?? []).join("").replace(/[（）]/g, "");
      out.push({
        id: `${law.lawId}-${a}`,
        lawName: j.revision_info.law_title,
        short: law.short,
        edition: `${j.revision_info.amendment_enforcement_date} 施行の版（e-Gov）`,
        article: toKanjiArticle(a),
        heading: caption,
        text: flatten(art).trim(),
        sourceUrl: `https://laws.e-gov.go.jp/law/${law.lawId}`,
      });
    }
  }
  return out;
}

const all = [...kaishaku(), ...shiyo(), ...(await egov())];
mkdirSync(new URL("../../functions/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../functions/data/laws.source.json", import.meta.url), JSON.stringify(all, null, 1));
console.log(`${all.length} articles`);
for (const l of all) console.log(`${l.id}\t${l.article}\t${l.heading}\t${l.text.length}字`);
