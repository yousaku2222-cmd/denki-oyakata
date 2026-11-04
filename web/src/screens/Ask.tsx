import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { call, errorText } from "../firebase";
import { getName, type Role } from "../local";
import { MicInput, Notice, SOURCE_LABEL, fmtDate, type Sentence } from "../components";
import { LawSheet, type LawRef } from "../LawSheet";
import { CalcCard, type CalcOutput } from "../CalcCard";
import { AskWaiting, CheckedLine } from "../AskWaiting";
import { useFlyToMe } from "../FlyToMe";
import { AnswerSample } from "../AnswerSample";
import { GlossSheet, Glossed, firstMentions, meaningsFor, useGlossary, type Term } from "../Glossary";
import { FlowSteps } from "../FlowSteps";
import { Icon, ic } from "../Icon";

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

const TICK_MS = 450; // every step shows ✓ for this long before the list folds into one line

// examples that show every kind of source (law, a veteran's card): the first thing a judge taps
// the questions young workers ask most, each with the picture of its kind
const EXAMPLES: [string, string][] = [
  [ic("license_scope"), "資格が無くても出来る作業はありますか？"],
  [ic("piping"), "PF管って何回まで曲げていい？"],
  [ic("support_spacing"), "VE管とPF管のサドルの違いは？"],
];
const GENERAL_PREVIEW = 2; // general sentences shown before 「もっと見る」 when a checked source comes first

// the last answer stays while other tabs are open (this screen unmounts), until the app is reloaded;
// one per role (切替 shows the other role its own), with whether 助かった / 親方にも聞く was already pressed
type Last = { asked: string; answer: Answer; helped?: boolean; sent?: boolean; sentNote?: string };
const lastOf: Partial<Record<Role, Last>> = {};

export function Ask({ role, seed, seedQuestionId }: { role: Role; seed?: string; seedQuestionId?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const last = seed ? undefined : lastOf[role];
  const [answer, setAnswerState] = useState<Answer | null>(last?.answer ?? null);
  const [asked, setAsked] = useState(last?.asked ?? "");
  const setAnswer = (a: Answer | null, q = asked) => {
    setAnswerState(a);
    if (a) lastOf[role] = { asked: q, answer: a };
  };
  const remember = (more: Partial<Last>) => {
    const l = lastOf[role];
    if (l) Object.assign(l, more);
  };
  // asked again from わたし: the veteran already answered it, so no 「親方にも聞く」
  const fromMe = !!seed;
  const [helped, setHelped] = useState(!!last?.helped);
  const [sent, setSent] = useState(!!last?.sent);
  const [sentNote, setSentNote] = useState(last?.sentNote ?? "");
  const [openLaw, setOpenLaw] = useState<{ id: string; quote?: string } | null>(null);
  const terms = useGlossary();
  const [gloss, setGloss] = useState<Term | null>(null);
  const [finished, setFinished] = useState(false);
  const [plusOne, setPlusOne] = useState(0);
  const { fly, envelope } = useFlyToMe();
  // opened from わたし with a question to ask again: ask it once, on arrival
  const seeded = useRef(false);
  useEffect(() => {
    if (!seed || seeded.current) return;
    seeded.current = true;
    void submit(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening, with the question it came with
  }, [seed]);

  // after: a follow-up to the question opened from わたし (the AI reads it as the continuation)
  async function submit(q = text, after?: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr("");
    setAnswer(null);
    setOpenGeneral(false);
    setHelped(false);
    setSent(false);
    setSentNote("");
    setAsked(q.trim());
    try {
      const a = await call<Answer>("ask", { text: q.trim(), askerRole: role, ...(after ? { after } : {}) });
      if (!a.cached) {
        setFinished(true);
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
      setAnswer(a, q.trim());
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
    remember({ helped: true });
    setPlusOne((n) => n + 1);
    await call("markHelped", { answerId: answer.answerId }).catch(() => {
      setHelped(false);
      remember({ helped: false });
    });
  }

  async function sendToBox(e: React.MouseEvent<HTMLButtonElement>) {
    const from = e.currentTarget.getBoundingClientRect(); // fly from the button that was pressed (always on screen)
    setSent(true);
    let r: { duplicate?: boolean; merged?: boolean; askers?: number };
    try {
      r = await call("sendToBox", { text: asked, askerName: getName(role), askerRole: role });
    } catch (e) {
      setSent(false);
      setErr(errorText(e, "質問箱に送れませんでした。もう一度お試しください。"));
      return;
    }
    if (r.duplicate) {
      const note = "この質問は、もう質問箱に入っています。親方が答えると、「わたし」に届きます。";
      setSentNote(note);
      remember({ sent: true, sentNote: note });
      return; // nothing new went in: no envelope
    }
    const note = r.merged
      ? `同じことを聞いた人が、ほかにもいます（あなたで${r.askers}人目）。親方が答えると、全員の「わたし」に届きます。`
      : "親方が答えると、「わたし」に届きます。";
    setSentNote(note);
    remember({ sent: true, sentNote: note });
    fly(from); // only once it is really in the box: it flies to わたし, where the answer will come back
  }

  const [openGeneral, setOpenGeneral] = useState(false);
  // once asked, the input folds into one line and the answer takes the screen
  const folded = busy || !!answer;
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (folded) top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [folded]);
  const cardOf = (id?: string) => answer?.cards.find((c) => c.id === id);
  // in the order the groups are shown, so a word is underlined where it is first read
  const ordered = answer ? SOURCES.flatMap((src) => answer.sentences.filter((s) => s.source === src)) : [];
  const glossMarks = firstMentions(ordered.map((s) => s.text), terms);
  const answerLawIds = ordered.flatMap((s) => (s.lawId ? [s.lawId] : []));

  return (
    <section className="screen" ref={top}>
      {folded ? (
        <div className="ask-bar">
          <span className="ask-bar-q">🎤 {asked}</span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setText(asked); // to fix the words and ask again
              setAnswerState(null);
              delete lastOf[role];
            }}
          >
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
          <p className="hint">親方の知恵が無かった質問は、名前を伏せて親方の話のきっかけになります。</p>
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
          <FlowSteps
            label="聞くと"
            steps={[
              { icon: ic("mic"), label: "聞く" },
              { icon: ic("law"), label: "出どころ\nつきの答え" },
              { icon: ic("box"), label: "親方に\n聞ける" },
            ]}
          />
          <p className="hint">よく聞かれる質問</p>
          {EXAMPLES.map(([icon, q]) => (
            <button key={q} className="chip example-chip" onClick={() => submit(q)}>
              <Icon of={icon} /> {q}
            </button>
          ))}
          <details className="sample-fold">
            <summary>📖 答えの見本を見る</summary>
            <AnswerSample onAsk={(q) => void submit(q)} />
          </details>
        </div>
      )}

      {err && <p className="hint error">{err}</p>}

      {answer && (
        <motion.div className="answer" key={answer.answerId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: answer.cached ? 0 : 0.35, duration: 0.25 }}>
          <p className="interpreted">
            こう受け取りました：<strong>{answer.interpretedAs}</strong>
          </p>
          {/* a tester went to look it up on the internet: the way to check is already here */}
          {answer.sentences.some((s) => s.source === "law") && (
            <div className="how-to-check">
              <span className="htc-title">🔍 確かめ方</span>
              <span>
                <b>📜 引用元</b> 押すと国の原文
              </span>
              <span>
                <b>✔ 一致</b> 原文と一字一句同じ
              </span>
              <details className="more-info">
                <summary>？</summary>
                ネットで探し直さなくても、ここから国の法令・基準の原文で確かめられます。
              </details>
            </div>
          )}
          {answer.mode === "dummy" && <p className="hint">※ 試験用のダミー応答です（AIの接続前）</p>}
          {answer.calcs?.map((c, i) => <CalcCard key={i} c={c} compact />)}

          <motion.div key={answer.answerId} className="sentences" initial="hidden" whileInView="shown" viewport={{ once: true }} variants={{ shown: { transition: { staggerChildren: STAGGER, delayChildren: 0.35 } } }}>
            {SOURCES.map((src) => {
              const rows = answer.sentences.filter((s) => s.source === src);
              if (!rows.length) return null;
              // when a checked source comes first, general knowledge shows its first sentences and the rest waits behind a tap
              const partial = src === "general" && answer.sentences.some((s) => s.source !== "general") && rows.length > GENERAL_PREVIEW;
              const shownRows = partial && !openGeneral ? rows.slice(0, GENERAL_PREVIEW) : rows;
              const count = src === "wisdom" ? `カード${new Set(rows.map((r) => r.cardId)).size}枚から` : `${rows.length}件`;
              return (
                <motion.div key={src} className={`src-group src-${src}`} variants={GROUP}>
                  <div className="src-head">
                    <span className="src-tag">
                      <Icon of={SOURCE_LABEL[src].icon} /> {SOURCE_LABEL[src].label} {count}
                    </span>
                  </div>
                  {shownRows.map((s, i) => {
                      const c = s.source === "wisdom" ? cardOf(s.cardId) : undefined;
                      const law = s.source === "law" ? answer.laws.find((l) => l.id === s.lawId) : undefined;
                      // say whose story it is once per run of sentences from the same card
                      const newCard = c && rows[i - 1]?.cardId !== s.cardId;
                      return (
                        <motion.div key={i} className="src-row" variants={SENTENCE} initial={src === "general" ? "hidden" : undefined} animate={src === "general" ? "shown" : undefined}>
                          <p>
                            <Glossed text={s.text} marks={glossMarks[ordered.indexOf(s)] ?? []} onOpen={(t) => setGloss(meaningsFor(t, answerLawIds))} />
                          </p>
                          {newCard && (
                            <p className="src-meta">
                              {c.author}の話{c.publishedAt ? `・${fmtDate(c.publishedAt)}` : ""}
                              {c.triggerAskerName ? `（きっかけ: ${c.triggerAskerName}さんの質問）` : ""}
                            </p>
                          )}
                          {law && (
                            <div className="cite-line">
                              <button className="cite-chip" onClick={() => setOpenLaw({ id: law.id, quote: s.quote })} title={s.quote}>
                                📜 引用元：{law.short} {law.article} ›
                              </button>
                              {/* only the quote is checked word for word; the sentence is the AI's reading of it */}
                              {s.verified && <Stamp />}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  {partial && (
                    <button className="link more" onClick={() => setOpenGeneral(!openGeneral)}>
                      {openGeneral ? "▲ 閉じる" : `▼ もっと見る（あと${rows.length - GENERAL_PREVIEW}件）`}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </motion.div>

          {answer.safetyNote && <Notice>⚠️ {answer.safetyNote}</Notice>}
          {openLaw && <LawSheet id={openLaw.id} highlight={openLaw.quote} onClose={() => setOpenLaw(null)} />}
          {gloss && <GlossSheet term={gloss} onClose={() => setGloss(null)} />}

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
                {/* only a veteran's card gets the thanks (markHelped counts the cards the answer used) */}
                {helped ? (answer.sentences.some((x) => x.source === "wisdom") ? "親方に届きました" : "ありがとうございます") : "助かった"}
                {plusOne > 0 && (
                  <motion.span key={`plus-${plusOne}`} className="plus-one" aria-hidden initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -38 }} transition={{ duration: 0.9, ease: "easeOut" }}>
                    👍 +1
                  </motion.span>
                )}
              </button>
            )}
            {!fromMe && (
            <button className={answer.grounded ? "secondary" : "primary"} disabled={sent} onClick={sendToBox}>
              {sent ? "📮 質問箱に入れました" : answer.grounded ? "📮 親方にも聞く" : "📮 親方に聞いてみる"}
            </button>
            )}
          </div>
          {fromMe && seed && seedQuestionId && <FollowUp role={role} prev={seed} prevId={seedQuestionId} first={asked !== seed ? asked : ""} busy={busy} onAsk={(q) => void submit(q, seed)} />}
          {sent && (
            <motion.p className="hint sent-note" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
              {sentNote}
            </motion.p>
          )}
        </motion.div>
      )}
      {envelope}
    </section>
  );
}

/**
 * Under an answer opened from わたし (a veteran answered that question): what to ask next. To the AI, as the
 * continuation of that question, or to the box as a follow-up that shows the veteran the earlier question and card.
 */
function FollowUp({ role, prev, prevId, first, busy, onAsk }: { role: Role; prev: string; prevId: string; first: string; busy: boolean; onAsk: (q: string) => void }) {
  // under the AI's answer to a follow-up, that follow-up is already in the box: one tap sends it on to the veteran
  const [text, setText] = useState(first);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const { fly, envelope } = useFlyToMe();

  async function toBox(e: React.MouseEvent<HTMLButtonElement>) {
    const from = e.currentTarget.getBoundingClientRect();
    setSending(true);
    setErr("");
    try {
      await call("sendToBox", { text: text.trim(), askerName: getName(role), askerRole: role, followUpOf: prevId });
      setNote(`「${text.trim()}」を、続きの質問として質問箱に入れました。親方が答えると、「わたし」に届きます。`);
      setText("");
      fly(from);
    } catch (e) {
      setErr(errorText(e, "質問箱に送れませんでした。もう一度お試しください。"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="follow-up">
      <p className="follow-up-head">続けて聞きたいことは？</p>
      <p className="src-meta">「{prev}」の続きとして聞きます</p>
      <MicInput value={text} onChange={setText} maxLength={500} micLabel="話す" placeholder="例: ボックスは何個まで入れていい？" />
      <div className="row">
        <button className="primary" disabled={!text.trim() || busy} onClick={() => onAsk(text)}>
          AIに聞く
        </button>
        <button className="secondary" disabled={!text.trim() || sending} onClick={toBox}>
          📮 親方に続けて聞く
        </button>
      </div>
      {err && <p className="hint error">{err}</p>}
      {note && <p className="hint sent-note">{note}</p>}
      {envelope}
    </div>
  );
}
