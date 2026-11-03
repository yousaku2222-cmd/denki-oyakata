import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Fired when a question went into the 質問箱: App puts a dot on わたし, where the answer will come back. */
export const SENT_TO_BOX = "oyakata:sent-to-box";

function landed() {
  window.dispatchEvent(new Event(SENT_TO_BOX));
  document.querySelector('[data-tab="me"] .tab-icon')?.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });
}

/**
 * A sent question flies as ✉️ from the button that was pressed to the わたし tab.
 * Call fly() only once the question is really in the box. Render `envelope` anywhere in the screen.
 */
export function useFlyToMe() {
  const [flight, setFlight] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const reduce = useReducedMotion();
  function fly(from: DOMRect) {
    const to = document.querySelector('[data-tab="me"]')?.getBoundingClientRect();
    if (to && !reduce) setFlight({ from, to });
    else landed();
  }
  const dx = flight ? flight.to.left + flight.to.width / 2 - (flight.from.left + flight.from.width / 2) : 0;
  const envelope = flight && (
    <motion.div
      className="envelope"
      aria-hidden
      style={{ left: flight.from.left + flight.from.width / 2 - 16, top: flight.from.top + flight.from.height / 2 - 16 }}
      initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
      animate={{
        x: [0, dx * 0.5, dx],
        y: [0, -70, flight.to.top - flight.from.top - flight.from.height / 2 + 8],
        scale: [1, 1.25, 0.45],
        rotate: [0, -12, 10],
      }}
      transition={{ duration: 0.95, ease: "easeInOut", times: [0, 0.4, 1] }}
      onAnimationComplete={() => {
        setFlight(null);
        landed();
      }}
    >
      ✉️
    </motion.div>
  );
  return { fly, envelope };
}
