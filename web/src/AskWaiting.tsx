import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

// What ask does on every question, in the order it usually runs. The server answers in one go,
// so the steps advance on a timer and the last one waits for the answer (no step it does not do).
const STEPS: { icon: string; text: string; at: number }[] = [
  { icon: "🔎", text: "質問を受け取りました", at: 0 },
  { icon: "🧰", text: "親方の知恵カードを探しています", at: 1200 },
  { icon: "⚖️", text: "法令・基準の条文を探しています", at: 2800 },
  { icon: "✍️", text: "答えを組み立てています", at: 4600 },
  { icon: "✔", text: "引用を条文の原文と照らしています", at: 8000 },
];

/** finished: the answer is in, so every step shows as done for a moment before the list folds away. */
export function AskWaiting({ question, finished = false }: { question: string; finished?: boolean }) {
  const [timed, setTimed] = useState(0);
  const step = finished ? STEPS.length : timed;
  useEffect(() => {
    const timers = STEPS.slice(1).map((s, i) => setTimeout(() => setTimed(i + 1), s.at));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <motion.div
      className="ask-waiting"
      role="status"
      aria-live="polite"
      exit={{ opacity: 0, height: 0, scaleY: 0.4, transition: { duration: 0.35, ease: "easeIn" } }}
      style={{ transformOrigin: "50% 0%", overflow: "hidden" }}
    >
      <ol>
        <AnimatePresence initial={false}>
          {STEPS.slice(0, Math.min(step + 1, STEPS.length)).map((s, i) => (
            <motion.li
              key={s.text}
              className={i < step ? "done" : "now"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <motion.span
                className="wait-icon"
                animate={i === step ? { rotateY: [0, 180, 360], scale: [1, 1.15, 1] } : { rotateY: 0, scale: 1 }}
                transition={i === step ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
              >
                {i < step ? "✓" : s.icon}
              </motion.span>
              <span>
                {s.text}
                {i === 0 && question ? `：「${question.length > 24 ? question.slice(0, 23) + "…" : question}」` : ""}
                {i === step && i > 0 && <Dots />}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </motion.div>
  );
}

/** What the answer was checked against, in one line that stays above it. Counts come from the answer itself. */
export function CheckedLine({ laws, cards, calcs, cached }: { laws: number; cards: number; calcs: number; cached: boolean }) {
  const found = [laws && `法令・基準 ${laws}件`, cards && `親方の知恵 ${cards}件`, calcs && `計算 ${calcs}件`].filter(Boolean);
  const text = cached
    ? "前に確かめた答えです"
    : found.length
      ? `${found.join("と")}を確かめました`
      : "法令・基準と親方の知恵からは見つかりませんでした";
  return (
    <motion.p
      className={`checked-line ${found.length || cached ? "ok" : "none"}`}
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <span aria-hidden>{found.length || cached ? "✓" : "—"}</span> {text}
    </motion.p>
  );
}

function Dots() {
  return (
    <span className="wait-dots" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}>
          ・
        </motion.span>
      ))}
    </span>
  );
}
