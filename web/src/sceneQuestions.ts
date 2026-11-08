// 🧭 選んで聞く: a young worker who cannot put the question into words picks where they are and what they do,
// and gets questions to start from (written by hand: shown at once, cost nothing, never odd). Only questions:
// the answers still come from the articles and the veterans' cards.
// A veteran gets the same chips on 話す, with openers made from the same words.

export const PLACES = [
  { key: "ceiling", label: "天井裏", talk: "天井裏" },
  { key: "floor", label: "床下", talk: "床下" },
  { key: "outdoor", label: "屋外", talk: "屋外" },
  { key: "panel", label: "盤まわり", talk: "盤まわり" },
  { key: "wall", label: "壁・器具付け", talk: "壁" },
] as const;
export const WORKS = [
  // talk: 「（場所で）〜時」, the veteran's opener
  { key: "pipe", label: "配管", talk: "配管をする" },
  { key: "wire", label: "配線・通線", talk: "配線や通線をする" },
  { key: "box", label: "ボックス", talk: "ボックスを付ける" },
  { key: "earth", label: "接地", talk: "接地（アース）を取る" },
  { key: "fixture", label: "器具・コンセント", talk: "器具を付ける" },
] as const;
export type Place = (typeof PLACES)[number]["key"];
export type Work = (typeof WORKS)[number]["key"];

// place null: anywhere (shown for any place, or when only a work is picked)
const Q: [Place | null, Work, string][] = [
  ["ceiling", "pipe", "天井裏でPF管を支える間隔は、どのくらい？"],
  ["ceiling", "pipe", "梁をよける時、管はどう回せばいい？"],
  ["ceiling", "pipe", "天井裏で、PF管とVE管はどう使い分ける？"],
  ["ceiling", "wire", "天井裏で、ケーブルを支えずに転がしておいていい？"],
  ["ceiling", "wire", "天井裏でケーブルを引く時、先にやっておくと楽になることは？"],
  ["ceiling", "wire", "断熱材の上や中をケーブルが通る時、気をつけることは？"],
  ["ceiling", "box", "天井裏のジョイントボックスは、どこに置けばいい？"],
  ["ceiling", "box", "天井裏で、ボックスを使わずに電線をつないでいい？"],
  ["ceiling", "fixture", "ダウンライトの穴をあける前に、確かめることは？"],
  ["ceiling", "fixture", "断熱材が敷いてある天井に、付けていい照明器具は？"],
  ["floor", "pipe", "床下で配管を支える時、何を使えばいい？"],
  ["floor", "wire", "床下で、ケーブルを地面に直接置いていい？"],
  ["floor", "wire", "床下に潜る前に、準備しておくものは？"],
  ["floor", "box", "床下でケーブルをつなぐ時、ボックスはどこに付ける？"],
  ["outdoor", "pipe", "屋外でPF管を使っていい？"],
  ["outdoor", "pipe", "屋外の配管で、雨水が入らないようにするには？"],
  ["outdoor", "pipe", "VE管を屋外で長く使う時、伸び縮みにはどう対応する？"],
  ["outdoor", "wire", "引込線の取付点の高さは、どのくらい？"],
  ["outdoor", "wire", "屋外でケーブルを壁に這わせる時、どう支える？"],
  ["outdoor", "earth", "接地棒は、どのくらいの深さに打てばいい？"],
  ["outdoor", "earth", "接地抵抗が下がらない時は、どうする？"],
  ["outdoor", "fixture", "屋外のコンセントは、どんな物を選べばいい？"],
  ["outdoor", "fixture", "エアコンの室外機の電源で、気をつけることは？"],
  ["panel", "wire", "分電盤の中で、電線をきれいにまとめるコツは？"],
  ["panel", "wire", "ブレーカーに電線をつなぐ時、締め付けで気をつけることは？"],
  ["panel", "wire", "盤の中の電線の色は、どう決まっている？"],
  ["panel", "earth", "漏電遮断器が必要なのは、どんな回路？"],
  ["panel", "earth", "分電盤のアースは、どこにつなぐ？"],
  ["panel", "fixture", "主幹ブレーカーの容量は、どう決める？"],
  ["panel", "fixture", "回路を増やしたいのに、盤に空きが無い時はどうする？"],
  ["panel", "wire", "盤の中で作業する前に、必ずやることは？"],
  ["wall", "wire", "壁の中にケーブルを通す時のコツは？"],
  ["wall", "wire", "仕上がった壁に、後から配線する時はどうする？"],
  ["wall", "box", "スイッチボックスの高さは、床から何cm？"],
  ["wall", "box", "ボックスの中で、電線をつなぐ時の注意は？"],
  ["wall", "fixture", "コンセントの差込口の、長い方と短い方の違いは？"],
  ["wall", "fixture", "片切スイッチで切るのは、どっちの線？"],
  ["wall", "fixture", "3路スイッチの結線が分からない時は、どう考える？"],
  ["wall", "fixture", "エアコン用の200Vコンセントは、どう見分ける？"],
  ["wall", "earth", "アース付きのコンセントが要るのは、どんな場所？"],
  [null, "pipe", "管の太さは、電線の本数でどう決める？"],
  [null, "wire", "VVFの1.6と2.0は、どう使い分ける？"],
  [null, "wire", "リングスリーブの刻印（○・小・中）は、どう選ぶ？"],
  [null, "box", "差込形コネクタとリングスリーブは、どう使い分ける？"],
  [null, "earth", "接地線の太さは、どう決める？"],
  [null, "earth", "D種接地とC種接地は、どう使い分ける？"],
];

/** The young worker's questions for what is picked (one of the two is enough). */
export function questionsFor(place: Place | null, work: Work | null): string[] {
  if (!place && !work) return [];
  const hit = Q.filter(([p, w]) => (!place || p === place || (p === null && !!work)) && (!work || w === work));
  // a place's own questions first, then the ones for anywhere
  return [...hit.filter(([p]) => p !== null), ...hit.filter(([p]) => p === null)].map(([, , q]) => q).slice(0, 6);
}

/** The veteran's openers on 話す, made from the picked words. */
export function openersFor(place: Place | null, work: Work | null): string[] {
  if (!place && !work) return [];
  const p = PLACES.find((x) => x.key === place)?.talk;
  const w = WORKS.find((x) => x.key === work)?.talk;
  // 「天井裏で配管をする時」「天井裏の作業で」「配管をする時」: each word once, as said
  const what = p && w ? `${p}で${w}時` : p ? `${p}の作業で` : `${w}時`;
  return [`${what}、新人がよくやる失敗は何ですか？`, `${what}、段取りでやっておくことは？`, `${what}、ヒヤッとしたことはありますか？`, `${what}、新人にまず教えることは？`];
}

// Which place and work a question is about, by its words (no AI: instant and free). A question with none of
// them is just not marked; the words are narrow so a question rarely lands in the wrong place.
const PLACE_WORDS: Record<Place, RegExp> = {
  ceiling: /天井/,
  floor: /床下/,
  outdoor: /屋外|外壁|屋側|引込|室外機|接地棒|雨/,
  panel: /盤|ブレーカ|遮断器|主幹/,
  wall: /壁|スイッチ|コンセント|器具付/,
};
const WORK_WORDS: Record<Work, RegExp> = {
  pipe: /配管|PF|ＰＦ|VE|ＶＥ|CD管|電線管|サドル|管を|管の|管は|管で|管が/,
  wire: /配線|通線|ケーブル|VVF|ＶＶＦ|電線|呼び線|結線|線を引|線が通/,
  box: /ボックス|リングスリーブ|コネクタ|ジョイント|接続/,
  earth: /接地|アース|漏電/,
  fixture: /コンセント|スイッチ|照明|ダウンライト|器具|エアコン/,
};
export function sceneOf(text: string): { places: Place[]; works: Work[] } {
  const t = text.normalize("NFKC");
  return {
    places: PLACES.map((p) => p.key).filter((k) => PLACE_WORDS[k].test(t)),
    works: WORKS.map((w) => w.key).filter((k) => WORK_WORDS[k].test(t)),
  };
}
/** Whether a question is about what is picked (each pick must match; nothing picked: no). */
export function inScene(text: string, place: Place | null, work: Work | null): boolean {
  if (!place && !work) return false;
  const s = sceneOf(text);
  return (!place || s.places.includes(place)) && (!work || s.works.includes(work));
}

// the same question in other words at its end (「…ことは？」/「…ことはありますか？」): the start is compared
const same = (a: string) => a.normalize("NFKC").replace(/[\s？?。、]/g, "").slice(0, 14);
/** After an answer: the next questions of the same place and work, not the one asked nor any asked before. */
export function nextFor(asked: string, before: string[] = []): string[] {
  const s = sceneOf(asked);
  if (!s.places.length && !s.works.length) return [];
  const seen = new Set([asked, ...before].map(same));
  // the closest first: same place and work; same work, for anywhere; same work elsewhere (only when no place was
  // said); same place, other work
  const score = ([p, w]: [Place | null, Work, string]) => {
    const pl = p !== null && s.places.includes(p);
    const wk = s.works.includes(w);
    if (pl && wk) return 4;
    if (wk && p === null) return 3;
    if (wk && !s.places.length) return 2;
    if (pl) return 1;
    return 0;
  };
  return Q.map((q, i) => ({ q: q[2], n: score(q), i }))
    .filter((x) => x.n > 0 && !seen.has(same(x.q)))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.q);
}
