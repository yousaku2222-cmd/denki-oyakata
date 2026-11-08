// 🧭 選んで聞く: a young worker who cannot put the question into words picks where they are and what they do,
// and gets questions to start from (written by hand: shown at once, cost nothing, never odd). Only questions:
// the answers still come from the articles and the veterans' cards.
// A veteran gets the same chips on 話す, with openers made from the same words.

export const PLACES = [
  { key: "ceiling", label: "天井裏" },
  { key: "floor", label: "床下" },
  { key: "outdoor", label: "屋外" },
  { key: "panel", label: "盤まわり" },
  { key: "wall", label: "壁・器具付け" },
] as const;
export const WORKS = [
  { key: "pipe", label: "配管", talk: "配管" },
  { key: "wire", label: "配線・通線", talk: "配線" },
  { key: "box", label: "ボックス", talk: "ボックスまわり" },
  { key: "earth", label: "接地", talk: "接地（アース）" },
  { key: "fixture", label: "器具・コンセント", talk: "器具付け" },
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
  const p = PLACES.find((x) => x.key === place)?.label;
  const w = WORKS.find((x) => x.key === work)?.talk;
  const what = p && w ? `${p}の${w}` : p ? `${p}の作業` : `${w}の作業`;
  return [`${what}で、新人がよくやる失敗は何ですか？`, `${what}で、段取りでやっておくことは？`, `${what}で、ヒヤッとしたことはありますか？`, `${what}で、新人にまず教えることは？`];
}
