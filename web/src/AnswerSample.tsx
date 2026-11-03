import { motion } from "motion/react";
import { SOURCE_LABEL } from "./components";

// Shown on 聞く before the first question: what one answer is made of. The lines are a real answer, shortened
// (標準仕様書 2.3.3 and a veteran's card on bending PF pipe), with no one's name.
const SAMPLE_Q = "PF管って何回まで曲げていい？";
const ROWS = [
  { src: "law", text: "曲げは4か所以下、合計270度まで。", meta: "標準仕様書 2.3.3 ✔ 原文と一致" },
  { src: "wisdom", text: "曲がりが多いと電線が通りにくく、被覆が傷つく。多い時はボックスを入れる。", meta: "ベテランが話した知恵カードから" },
  { src: "general", text: "現場の仕様書にも、回数の指定がないか確かめる。", meta: "" },
] as const;

const ROW = { hidden: { opacity: 0, x: -16 }, shown: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" as const } } };

export function AnswerSample({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <motion.section className="sample" initial="hidden" whileInView="shown" viewport={{ once: true }} variants={{ shown: { transition: { staggerChildren: 0.35, delayChildren: 0.2 } } }}>
      <p className="sample-head">
        <strong>答えの見本</strong>　こんなふうに答えます
      </p>
      <p className="sample-q">🙋「{SAMPLE_Q}」</p>
      {ROWS.map((r) => (
        <motion.div key={r.src} className={`sample-row src-${r.src}`} variants={ROW}>
          <span className="src-tag">
            {SOURCE_LABEL[r.src].icon} {SOURCE_LABEL[r.src].label}
          </span>
          <p>{r.text}</p>
          {r.meta && <p className="src-meta">{r.meta}</p>}
        </motion.div>
      ))}
      <motion.p className="sample-sum" variants={ROW}>
        ⚖️条文 ＋ 🧰親方の知恵 ＋ 💡一般知識
        <br />→ 1つの答えに（出どころつき）
      </motion.p>
      <motion.button className="secondary" variants={ROW} onClick={() => onAsk(SAMPLE_Q)}>
        この質問を聞いてみる →
      </motion.button>
    </motion.section>
  );
}
