import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { call, errorText } from "../firebase";
import { getName, type Role } from "../local";
import { MicInput, Notice, SOURCE_LABEL, fmtDate, type Sentence } from "../components";
import { LawSheet, type LawRef } from "../LawSheet";
import { CalcCard, type CalcOutput } from "../CalcCard";
import { AskWaiting, CheckedLine } from "../AskWaiting";

// Sentences come in one by one, and the check of a law quote lands on it like a seal: the check is the program's, not the AI's.
// The list starts moving when it scrolls into view (a calculation card above can push it below the fold).
const STAGGER = 0.25;
const SENTENCE = { hidden: { opacity: 0, y: 18 }, shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" as const } } };
const GROUP = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" as const, staggerChildren: STAGGER, delayChildren: 0.15 } },
};
const SOURCES = ["law", "wisdom", "general"] as const;
const STAMP = {
  hidden: { opacity: 0, scale: 1.9, rotate: -16 },
  shown: { opacity: 1, scale: 1, rotate: -4, transition: { delay: 0.4, type: "spring" as const, stiffness: 520, damping: 18 } },
};
const RING = {
  hidden: { opacity: 0, scale: 1 },
  shown: { opacity: [0, 0.55, 0], scale: [1, 1, 1.7], transition: { delay: 0.52, duration: 0.6, times: [0, 0.05, 1] } },
};

function Stamp() {
  return (
    <motion.span className="stamp" variants={STAMP}>
      ✔ 引用は原文と一致
      <motion.span className="stamp-ring" aria-hidden variants={RING} />
    </motion.span>
  );
}

interface Answer {
  answerId: string;
  interpretedAs: string;
  sentences: Sentence[];
  grounded: boolean;
  mode: "claude" | "dummy";
  safetyNote: string | null;
  cards: { id: string; title: string; author: string; publishedAt: number | null; triggerAskerName: string | null }[];
  laws: LawRef[];
  calcs?: CalcOutput[];
  cached?: boolean;
}

/** Fired when a question went into the 質問箱: App puts a dot on わたし, where the answer will come back. */
export const SENT_TO_BOX = "oyakata:sent-to-box";

const TICK_MS = 450; // every step shows ✓ for this long before the list folds into one line

const EXAMPLES = ["資格が無くても出来る作業はありますか？", "PF管って何回まで曲げていい？", "圧着端子の2とか3.5って何の数字？"];

export function Ask({ role }: { role: Role }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [helped, setHelped] = useState(false);
  const [sent, setSent] = useState(false);
  const [openLaw, setOpenLaw] = useState<{ id: string; quote?: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [plusOne, setPlusOne] = useState(0);
  const [flight, setFlight] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const reduceMotion = useReducedMotion();

  async function submit(q = text) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr("");
    setAnswer(null);
    setOpenGeneral(false);
    setHelped(false);
    setSent(false);
    setAsked(q.trim());
    try {
      const a = await call<Answer>("ask", { text: q.trim(), askerRole: role });
      if (!a.cached) {
        setFinished(true);
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
      setAnswer(a);
      setText("");
    } catch (e) {
      setErr(errorText(e, "答えを取得できませんでした。電波の良い所で、もう一度お試しください。"));
    } finally {
      setBusy(false);
      setFinished(false);
    }
  }

  async function helpedClick() {
    if (!answer) return;
    setHelped(true);
    setPlusOne((n) => n + 1);
    await call("markHelped", { answerId: answer.answerId }).catch(() => setHelped(false));
  }

  async function sendToBox(e: React.MouseEvent<HTMLButtonElement>) {
    const from = e.currentTarget.getBoundingClientRect(); // fly from the button that was pressed (always on screen)
    setSent(true);
    try {
      await call("sendToBox", { text: asked, askerName: getName(role), askerRole: role });
    } catch (e) {
      setSent(false);
      setErr(errorText(e, "質問箱に送れませんでした。もう一度お試しください。"));
      return;
    }
    // only once it is really in the box: the question flies to わたし, where the answer will come back
    const to = document.querySelector('[data-tab="me"]')?.getBoundingClientRect();
    if (to && !reduceMotion) setFlight({ from, to });
    else landed();
  }

  function landed() {
    setFlight(null);
    window.dispatchEvent(new Event(SENT_TO_BOX));
    document.querySelector('[data-tab="me"] .tab-icon')?.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });
  }

  const [openGeneral, setOpenGeneral] = useState(false);
  // once asked, the input folds into one line and the answer takes the screen
  const folded = busy || !!answer;
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (folded) top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [folded]);
  const cardOf = (id?: string) => answer?.cards.find((c) => c.id === id);

  return (
    <section className="screen" ref={top}>
      {folded ? (
        <div className="ask-bar">
          <span className="ask-bar-q">🎤 {asked}</span>
          <button className="secondary" disabled={busy} onClick={() => setAnswer(null)}>
            聞き直す
          </button>
        </div>
      ) : (
        <>
          <h1 className="screen-title">現場の疑問を、聞いてみよう</h1>
          <MicInput value={text} onChange={setText} maxLength={500} micLabel="話して聞く" placeholder="例: VE管とPF管の支持の違いは？（話し言葉・方言のままでOK）" />
          <button className="primary" disabled={!text.trim()} onClick={() => submit()}>
            聞く
          </button>
        </>
      )}

      <AnimatePresence mode="wait">
        {busy && !answer ? (
          <AskWaiting key="waiting" question={asked} finished={finished} />
        ) : answer ? (
          <CheckedLine
            key={`checked-${answer.answerId}`}
            laws={new Set(answer.sentences.flatMap((s) => (s.source === "law" && s.lawId ? [s.lawId] : []))).size}
            cards={new Set(answer.sentences.flatMap((s) => (s.source === "wisdom" && s.cardId ? [s.cardId] : []))).size}
            calcs={answer.calcs?.length ?? 0}
            cached={!!answer.cached}
          />
        ) : null}
      </AnimatePresence>

      {!folded && (
        <div className="examples">
          <p className="hint">よく聞かれる質問</p>
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => submit(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {err && <p className="hint error">{err}</p>}

      {answer && (
        <motion.div className="answer" key={answer.answerId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: answer.cached ? 0 : 0.35, duration: 0.25 }}>
          <p className="interpreted">
            こう受け取りました：<strong>{answer.interpretedAs}</strong>
          </p>
          {answer.mode === "dummy" && <p className="hint">※ 試験用のダミー応答です（AIの接続前）</p>}
          {answer.calcs?.map((c, i) => <CalcCard key={i} c={c} compact />)}

          <motion.div key={answer.answerId} className="sentences" initial="hidden" whileInView="shown" viewport={{ once: true }} variants={{ shown: { transition: { staggerChildren: STAGGER, delayChildren: 0.35 } } }}>
            {SOURCES.map((src) => {
              const rows = answer.sentences.filter((s) => s.source === src);
              if (!rows.length) return null;
              // general knowledge waits behind a tap when there is a checked source to read first
              const folded = src === "general" && answer.sentences.some((s) => s.source !== "general") && !openGeneral;
              return (
                <motion.div key={src} className={`src-group src-${src}`} variants={GROUP}>
                  <div className="src-head">
                    <span className="src-tag">
                      {SOURCE_LABEL[src].icon} {SOURCE_LABEL[src].label} {rows.length}件
                    </span>
                    {folded && (
                      <button className="link" onClick={() => setOpenGeneral(true)}>
                        ▶ 開く
                      </button>
                    )}
                  </div>
                  {!folded &&
                    rows.map((s, i) => {
                      const c = s.source === "wisdom" ? cardOf(s.cardId) : undefined;
                      const law = s.source === "law" ? answer.laws.find((l) => l.id === s.lawId) : undefined;
                      // say whose story it is once per run of sentences from the same card
                      const newCard = c && rows[i - 1]?.cardId !== s.cardId;
                      return (
                        <motion.div key={i} className="src-row" variants={SENTENCE} initial={src === "general" ? "hidden" : undefined} animate={src === "general" ? "shown" : undefined}>
                          <p>{s.text}</p>
                          {newCard && (
                            <p className="src-meta">
                              {c.author}の話{c.publishedAt ? `・${fmtDate(c.publishedAt)}` : ""}
                              {c.triggerAskerName ? `（きっかけ: ${c.triggerAskerName}さんの質問）` : ""}
                            </p>
                          )}
                          {law && (
                            <div className="cite-line">
                              <button className="cite-chip" onClick={() => setOpenLaw({ id: law.id, quote: s.quote })} title={s.quote}>
                                📜 {law.short} {law.article} ›
                              </button>
                              {/* only the quote is checked word for word; the sentence is the AI's reading of it */}
                              {s.verified && <Stamp />}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                </motion.div>
              );
            })}
          </motion.div>

          {answer.safetyNote && <Notice>⚠️ {answer.safetyNote}</Notice>}
          {openLaw && <LawSheet id={openLaw.id} highlight={openLaw.quote} onClose={() => setOpenLaw(null)} />}

          {!answer.grounded && (
            <div className="no-ground">
              <p>
                <strong>親方の知恵や法令の根拠が見つかりませんでした。</strong>
                <br />
                親方に聞いてみましょう。答えが届くと、次からは誰でも聞けるようになります。
              </p>
            </div>
          )}

          <div className="row">
            {answer.grounded && (
              <button className={`secondary helped-btn ${helped ? "done" : ""}`} disabled={helped} onClick={helpedClick}>
                <motion.span key={plusOne} className="helped-thumb" animate={plusOne ? { scale: [1, 1.5, 0.9, 1], rotate: [0, -15, 8, 0] } : {}} transition={{ duration: 0.45 }}>
                  👍
                </motion.span>{" "}
                {helped ? "親方に届きました" : "助かった"}
                {plusOne > 0 && (
                  <motion.span key={`plus-${plusOne}`} className="plus-one" aria-hidden initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -38 }} transition={{ duration: 0.9, ease: "easeOut" }}>
                    👍 +1
                  </motion.span>
                )}
              </button>
            )}
            <button className={answer.grounded ? "secondary" : "primary"} disabled={sent} onClick={sendToBox}>
              {sent ? "📮 質問箱に入れました" : answer.grounded ? "📮 親方にも聞く" : "📮 親方に聞いてみる"}
            </button>
          </div>
          {sent && (
            <motion.p className="hint sent-note" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
              親方が答えると、「わたし」に届きます。
            </motion.p>
          )}
        </motion.div>
      )}
      {flight && (
        <motion.div
          className="envelope"
          aria-hidden
          style={{ left: flight.from.left + flight.from.width / 2 - 16, top: flight.from.top + flight.from.height / 2 - 16 }}
          initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
          animate={{
            x: [0, (flight.to.left + flight.to.width / 2 - (flight.from.left + flight.from.width / 2)) * 0.5, flight.to.left + flight.to.width / 2 - (flight.from.left + flight.from.width / 2)],
            y: [0, -70, flight.to.top - flight.from.top - flight.from.height / 2 + 8],
            scale: [1, 1.25, 0.45],
            rotate: [0, -12, 10],
          }}
          transition={{ duration: 0.95, ease: "easeInOut", times: [0, 0.4, 1] }}
          onAnimationComplete={landed}
        >
          ✉️
        </motion.div>
      )}
    </section>
  );
}
