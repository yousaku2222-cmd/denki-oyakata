import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { db, spaces } from "./firebase";

interface DraftLike {
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
}


/** Pieces of what the veteran said, to be drawn into the card (the longest phrases read best). */
function phrases(said: string[]): string[] {
  const parts = said
    .join("。")
    .split(/[。、！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 5);
  return [...new Set(parts)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 6)
    .map((s) => (s.length > 18 ? s.slice(0, 17) + "…" : s));
}

// where each phrase floats before it is drawn in (fixed, so the scene looks the same every time)
const SPOTS = [
  { x: -36, y: 4, r: -5 },
  { x: 40, y: 38, r: 4 },
  { x: -46, y: 72, r: 3 },
  { x: 32, y: 106, r: -4 },
  { x: -28, y: 140, r: 5 },
  { x: 44, y: 174, r: -3 },
];
const CARD_Y = 236;

/**
 * The moment a card is born: the veteran's words light up, are drawn into one card,
 * and its fields fill in one by one. It then rests on the filled card (the veteran reads it
 * at their own pace) until they tap to check the draft. A tap at any time goes straight there.
 */
export function CardBirth({ said, draft, onDone }: { said: string[]; draft: DraftLike; onDone: () => void }) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => (reduce ? [] : phrases(said)), [said, reduce]);
  const rows: [string, string][] = [
    ["場面", draft.scene],
    ["やり方", draft.body],
    ["理由・失敗", draft.reason],
    ["新人の間違い", draft.caution],
  ];
  const cardAt = 0.35 + bits.length * 0.08 + 0.75; // after the words have flown in
  return (
    <section className="screen birth" onClick={onDone} aria-label="知恵カードができました（押すと次へ）">
      <p className="birth-lead">あなたの話から、知恵カードを作っています</p>
      <div className="birth-stage">
        {bits.map((b, i) => {
          const s = SPOTS[i % SPOTS.length];
          const fly = 0.35 + i * 0.08 + 0.5;
          return (
            <motion.span
              key={i}
              className="birth-word"
              initial={{ opacity: 0, x: s.x, y: s.y + 12, rotate: s.r, scale: 0.9 }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: [s.x, s.x, s.x, 0],
                y: [s.y + 12, s.y, s.y, CARD_Y],
                scale: [0.9, 1, 1.05, 0.3],
                rotate: [s.r, s.r, s.r, 0],
              }}
              transition={{ duration: fly + 0.45, times: [0, (0.35 + i * 0.08) / (fly + 0.45), fly / (fly + 0.45), 1], ease: "easeInOut" }}
            >
              {b}
            </motion.span>
          );
        })}
        <motion.div
          className="birth-card"
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: cardAt - 0.25, type: "spring", stiffness: 260, damping: 20 }}
        >
          <span className="src-tag">🧰 知恵カード</span>
          <motion.p className="birth-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: cardAt }}>
            {draft.title}
          </motion.p>
          {rows.map(([label, value], i) => (
            <motion.div
              key={label}
              className="birth-row"
              initial={{ opacity: 0, x: -12, backgroundColor: "rgba(255, 196, 0, 0.55)" }}
              animate={{ opacity: 1, x: 0, backgroundColor: "rgba(255, 196, 0, 0)" }}
              transition={{ delay: cardAt + 0.3 + i * 0.22, duration: 0.5, backgroundColor: { delay: cardAt + 0.45 + i * 0.22, duration: 0.8 } }}
            >
              <span>{label}</span>
              <p>{value || "（なし）"}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
      <motion.button
        className="primary birth-next"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: cardAt + 0.3 + rows.length * 0.22 + 0.3 }}
      >
        中身を確かめる →
      </motion.button>
    </section>
  );
}

/** Published: the card shrinks into the 知恵袋 and the count goes up by one. */
export function IntoTheBag({ title }: { title: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    getCountFromServer(query(collection(db, "cards"), where("companyId", "in", spaces()), where("status", "==", "published")))
      .then((s) => setCount(s.data().count))
      .catch(() => setCount(null)); // the bag still shows, just without the number
  }, []);
  return (
    <div className="bag-scene" aria-hidden>
      <motion.div
        className="bag-card"
        initial={{ y: -40, scale: 1, opacity: 1, rotate: -3 }}
        animate={{ y: [-40, -50, 62], scale: [1, 1.04, 0.3], opacity: [1, 1, 0], rotate: [-3, -3, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 1], ease: "easeIn", delay: 0.3 }}
      >
        🧰 {title}
      </motion.div>
      <motion.img
        className="bag"
        src="/bag.png"
        alt=""
        initial={{ scaleY: 1, scaleX: 1 }}
        animate={{ scaleY: [1, 1, 0.9, 1.05, 1], scaleX: [1, 1, 1.07, 0.97, 1] }}
        transition={{ duration: 0.6, delay: 1.3 }}
      />
      {count !== null && (
        <p className="bag-count">
          これで{" "}
          <span className="bag-num">
          <motion.span key="before" initial={{ opacity: 1, y: 0 }} animate={{ opacity: 0, y: -14 }} transition={{ delay: 1.5, duration: 0.3 }}>
            {count - 1}
          </motion.span>
          <motion.span key="after" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6, duration: 0.3 }}>
            {count}
          </motion.span>
          </span>{" "}
          枚
        </p>
      )}
    </div>
  );
}
