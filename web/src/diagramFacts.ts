// The numbers drawn in 「図で見る」, each with the words of the original article they come from.
// The AI's sentences are never read for a number: a figure is drawn only from these values.
// No imports here: functions/src/diagrams.test.ts loads this file too and checks, against laws.json, that every
// source is in the original word for word and that every number drawn is in those words.

export interface FigureFact {
  lawId: string; // functions/data/laws.json
  // the quote of a law sentence (already checked against the original) must hold one of these words:
  // an article has other rules too (2.3.3 also says how far apart to tie the pipe to rebar), and those get no figure
  when: string[];
  sources: string[]; // words of the original the numbers come from (shown under the figure)
}

/** 1区間（ボックスからボックスまで）の曲げ */
export interface BendFact extends FigureFact {
  pipe: string;
  bends: number; // 屈曲箇所は ◯ 箇所以下
  total: number; // 曲げ角度の合計が ◯ 度を超えてはならない
  each: number; // 曲げ角度は ◯ 度を超えてはならない（1か所）
}

/** 管を支持する間隔 */
export interface SupportFact extends FigureFact {
  pipe: string;
  meters: number; // ◯m 以下
}

// 標準仕様書 2.2.3・2.3.3・2.4.3 (4)/(3): the same words in all three. 2.2.4・2.3.4・2.4.4 (露出) only point to these
// items ("2.3.3(1)から(4)までによる") without the numbers, so they get no bend figure.
const BEND_SOURCES = ["分岐回路の配管 1 区間の屈曲箇所は、4 箇所以下とし、曲げ角度の合計が 270 度を超えてはならない", "曲げ角度は 90 度を超えてはならない"];
const BEND_WHEN = ["屈曲箇所", "曲げ角度"];
export const BEND_FACTS: BendFact[] = [
  { lawId: "shiyo-2.2.3", pipe: "金属管", when: BEND_WHEN, sources: BEND_SOURCES, bends: 4, total: 270, each: 90 },
  { lawId: "shiyo-2.3.3", pipe: "PF管・CD管", when: BEND_WHEN, sources: BEND_SOURCES, bends: 4, total: 270, each: 90 },
  { lawId: "shiyo-2.4.3", pipe: "硬質ビニル管（VE管）", when: BEND_WHEN, sources: BEND_SOURCES, bends: 4, total: 270, each: 90 },
];

// Each article has its own value: 金属管 2m, PF・CD管の隠ぺい 1.5m, 露出 1m, 硬質ビニル管 1.5m, 可とう管 1m.
// 2.3.3 (6) 「1ｍ以下の間隔で鉄筋に結束」 is about rebar, not saddles: 「取付け間隔」 keeps it out.
const SADDLE = ["取付け間隔", "サドル"];
export const SUPPORT_FACTS: SupportFact[] = [
  { lawId: "kaishaku-158", pipe: "合成樹脂管", when: ["支持点間"], sources: ["管の支持点間の距離は1.5m以下とし"], meters: 1.5 },
  { lawId: "shiyo-2.2.3", pipe: "金属管", when: SADDLE, sources: ["管の支持は、サドル、ハンガ等を使用し、その取付け間隔は 2ｍ以下とする"], meters: 2 },
  { lawId: "shiyo-2.3.3", pipe: "PF管・CD管（隠ぺい）", when: SADDLE, sources: ["その取付け間隔は 1.5ｍ以下とする"], meters: 1.5 },
  { lawId: "shiyo-2.3.4", pipe: "PF管・CD管（露出）", when: SADDLE, sources: ["管の支持は、サドル、クリップ、ハンガ等を使用し、その取付け間隔は 1ｍ以下とする"], meters: 1 },
  { lawId: "shiyo-2.4.3", pipe: "硬質ビニル管（VE管）", when: SADDLE, sources: ["管の支持は、サドル、ハンガ等を使用し、その取付け間隔は、1.5ｍ以下とする"], meters: 1.5 },
  // the ただし (縦に通して人が触れない所は 2m) is left to the original: the figure shows the usual case
  { lawId: "shiyo-2.5.3", pipe: "金属製可とう電線管", when: SADDLE, sources: ["管の支持は、サドル、ハンガ等を使用し、その取付け間隔は、1ｍ以下とする"], meters: 1 },
];

/** Line breaks, spaces and full/half width differ between the original and a quote (as laws.ts normalizeForQuote). */
export const norm = (s: string) => s.normalize("NFKC").replace(/[\s｜|]/g, "");

/** The fact a checked law quote calls for, if any. */
export function factFor<T extends FigureFact>(facts: T[], lawId: string, quote: string): T | undefined {
  const q = norm(quote);
  return facts.find((f) => f.lawId === lawId && f.when.some((w) => q.includes(norm(w))));
}
