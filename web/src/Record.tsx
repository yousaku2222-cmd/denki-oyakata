import { useEffect, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "motion/react";

/**
 * The quiet frame of あなたの知恵が届いた先 (わたしのカード) and わたしの記録 (わたし): it fades up once when the
 * screen opens. No confetti, titles or locked badges: a record of what happened, like a letter of thanks.
 */
export function RecordFrame({ className = "", label, children }: { className?: string; label: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.section className={`record ${className}`} aria-label={label} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
      {children}
    </motion.section>
  );
}

/** A big number, counted up once from 0 when it first shows (shown as it is when motion is reduced). */
export function CountOnce({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const a = animate(0, to, { duration: 0.6, ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => a.stop();
  }, [to, reduce]);
  return <>{reduce ? to : n}</>;
}
