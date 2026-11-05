import { Fragment, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { call, errorText } from "../firebase";
import { getName, getTrial, type Role } from "../local";
import { MicInput, Notice, SOURCE_LABEL, SendCheck, fmtDate, heldOf, type BoxHeld, type BoxSent, type Sentence } from "../components";
import { LawSheet, type LawRef } from "../LawSheet";
import { CalcCard, type CalcOutput } from "../CalcCard";
import { AnswerDiagrams } from "../Diagrams";
import { AskWaiting, CheckedLine } from "../AskWaiting";
import { useFlyToMe } from "../FlyToMe";
import { AnswerSample } from "../AnswerSample";
import { GlossSheet, Glossed, fieldTerms, firstMentions, meaningsFor, useGlossary, type FieldWord, type Term } from "../Glossary";
import { Icon, ic } from "../Icon";
import { LawCheckBadge, LawLinks, SpecNote, type LawLink } from "../LawCheck";

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
  hidden: { opacity: 0, scale: 1.9, rotate: -10 },
  shown: { opacity: 1, scale: 1, rotate: 0, transition: { delay: 0.4, type: "spring" as const, stiffness: 520, damping: 18 } },
};
const RING = {
  hidden: { opacity: 0, scale: 1 },
  shown: { opacity: [0, 0.55, 0], scale: [1, 1, 1.3], transition: { delay: 0.52, duration: 0.6, times: [0, 0.05, 1] } },
};

/** Once per law group: how many of its quotes the program found word for word in the original. */
function Stamp({ n, of }: { n: number; of: number }) {
  return (
    <motion.span className="stamp" variants={STAMP}>
      ✔ {n === of ? (of > 1 ? `引用${of}件すべて原文と一致` : "引用は原文と一致") : `引用${of}件中${n}件が原文と一致`}
      <motion.span className="stamp-ring" aria-hidden variants={RING} />
    </motion.span>
  );
}

interface Answer {
  answerId: string;
  interpretedAs: string;
  conclusion?: string | null; // written from the sentences below (Haiku), numbers checked by the program
  sentences: Sentence[];
  grounded: boolean;
  mode: "claude" | "dummy";
  safetyNote: string | null;
  cards: { id: string; title: string; author: string; publishedAt: number | null; triggerAskerName: string | null; terms?: FieldWord[]; lawCheck?: { checkedAt: number } | null; specDiffers?: string[]; lawRefs?: LawLink[] }[];
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
  // calls the program's 資格の判定 (計算 has no tab of its own now: this is where a judge sees it)
  [ic("calc"), "高圧で受電している工場の、キュービクルの工事は第二種でできる？"],
];
const GENERAL_PREVIEW = 2; // general sentences shown before 「もっと見る」 when a checked source comes first

// the last answer stays while other tabs are open (this screen unmounts), until the app is reloaded;
// one per role (切替 shows the other role its own), with whether 助かった / 親方にも聞く was already pressed
type Last = { asked: string; answer: Answer; helped?: boolean; sent?: boolean; sentNote?: string };
const lastOf: Partial<Record<Role, Last>> = {};
// a question still on its way: leaving the tab does not lose it. Coming back shows the waiting again, and an
// answer that lands while away is kept in lastOf for the next opening
type Pending = { asked: string; done: Promise<Answer> };
const pendingOf: Partial<Record<Role, Pending>> = {};

export function Ask({ role, seed, seedQuestionId }: { role: Role; seed?: string; seedQuestionId?: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [boxErr, setBoxErr] = useState(""); // a failed 親方に聞く, shown under that button
  const [boxHeld, setBoxHeld] = useState<BoxHeld | null>(null); // held back: the veteran might not understand it
  const last = seed ? undefined : lastOf[role];
  const pending = seed ? undefined : pendingOf[role];
  const [busy, setBusy] = useState(!!pending);
  const [answer, setAnswerState] = useState<Answer | null>(pending ? null : (last?.answer ?? null));
  const [asked, setAsked] = useState(pending?.asked ?? last?.asked ?? "");
  const setAnswer = (a: Answer | null, q = asked) => {
    setAnswerState(a);
    if (a) lastOf[role] = { asked: q, answer: a };
  };
  const remember = (more: Partial<Last>) => {
    const l = lastOf[role];
    if (l) Object.assign(l, more);
  };
  // asked again from わたし: the veteran already answered it, so no 「親方にも聞く」
  // (a part from 部材帳 also comes with a seed, but no question id: that one can still go to the box)
  const fromMe = !!seedQuestionId;
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
  // came back while the question was still on its way: wait for the same call, not a new one
  useEffect(() => {
    if (pending) void wait(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // after: a follow-up to the question opened from わたし (the AI reads it as the continuation)
  async function submit(q = text, after?: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr("");
    setBoxErr("");
    setBoxHeld(null);
    setAnswer(null);
    setOpenGeneral(false);
    setHelped(false);
    setSent(false);
    setSentNote("");
    setAsked(q.trim());
    delete lastOf[role];
    const p: Pending = { asked: q.trim(), done: call<Answer>("ask", { text: q.trim(), askerRole: role, ...(after ? { after } : {}) }) };
    pendingOf[role] = p;
    p.done.then(
      (a) => {
        if (pendingOf[role] !== p) return;
        delete pendingOf[role];
        lastOf[role] = { asked: p.asked, answer: a };
      },
      () => {
        if (pendingOf[role] === p) delete pendingOf[role];
      },
    );
    await wait(p);
  }

  async function wait(p: Pending) {
    try {
      const a = await p.done;
      if (!a.cached) {
        setFinished(true);
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
      setAnswer(a, p.asked);
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

  // fly from the button that was pressed (always on screen)
  const sendToBox = (e: React.MouseEvent<HTMLButtonElement>) => void toBox(asked, false, e.currentTarget.getBoundingClientRect());

  // confirmed: the asker chose these words after the check (「直した文で送る」「このまま送る」): not checked again
  async function toBox(q: string, confirmed: boolean, from: DOMRect) {
    setSent(true);
    setBoxErr("");
    let r: BoxSent;
    try {
      r = await call<BoxSent>("sendToBox", { text: q, askerName: getName(role), askerRole: role, ...(confirmed ? { confirmed: true } : {}) });
    } catch (e) {
      setSent(false);
      setBoxErr(errorText(e, "質問箱に送れませんでした。もう一度お試しください。"));
      return;
    }
    const held = heldOf(r, q);
    setBoxHeld(held);
    if (held) {
      setSent(false); // not sent: the asker chooses below
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
    const fixed = q !== asked ? `「${q}」として送りました。` : ""; // the words the veteran will read
    setSentNote(fixed + note);
    remember({ sent: true, sentNote: fixed + note });
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
  // ⚖️ 条文で確かめる under the 親方の知恵 group: the cards' sentences that agree with an article, in the order the cards are read
  const wisdomCards = answer ? [...new Set(answer.sentences.filter((s) => s.source === "wisdom").map((s) => s.cardId))].flatMap((id) => cardOf(id) ?? []) : [];
  const lawLinks = wisdomCards.flatMap((c) => (c.lawRefs ?? []).map((l) => ({ ...l, from: wisdomCards.length > 1 ? c.title : undefined })));
  const linksId = answer ? `law-links-${answer.answerId}` : "";
  // 審査員モード: the judge's own cards in this answer (what they told as a veteran a minute ago), marked as theirs.
  // The answer does not say whose a card is: myCards does (this device's cards, in any space)
  const [mine, setMine] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!getTrial() || !answer?.cards.length) return;
    call<{ cards: { id: string }[] }>("myCards", {})
      .then((r) => setMine(new Set(r.cards.map((c) => c.id))))
      .catch(() => {}); // only a label
  }, [answer]);
  // in the order the groups are shown, so a word is underlined where it is first read
  const ordered = answer ? SOURCES.flatMap((src) => answer.sentences.filter((s) => s.source === src)) : [];
  // a veteran's sentence also underlines the words of its own card (dialect, the company's names), before the glossary's
  const glossMarks = firstMentions(
    ordered.map((s) => s.text),
    terms,
    ordered.map((s) => (s.source === "wisdom" ? fieldTerms(cardOf(s.cardId)?.terms) : [])),
  );
  const answerLawIds = ordered.flatMap((s) => (s.lawId ? [s.lawId] : []));

  return (
    <section className="screen" ref={top}>
      {folded ? (
        <div className="ask-bar">
          <span className="ask-bar-q">🎤 {asked}</span>
          <div className="ask-bar-btns">
            {/* a new question starts empty; 言い直す keeps the words, to fix a mishearing */}
            {[
              { label: "別のことを聞く", cls: "primary", words: "" },
              { label: "言い直す", cls: "secondary", words: asked },
            ].map((b) => (
              <button
                key={b.label}
                className={b.cls}
                disabled={busy}
                onClick={() => {
                  setText(b.words);
                  setAnswerState(null);
                  setErr("");
                  setBoxErr("");
                  setBoxHeld(null);
                  delete lastOf[role];
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <h1 className="screen-title">現場の疑問を、聞いてみよう</h1>
          <MicInput value={text} onChange={setText} maxLength={500} micLabel="話して聞く" placeholder="例: VE管とPF管の支持の違いは？（話し言葉・方言のままでOK）" />
          {/* shown once there is something to ask: a grey button that cannot be pressed only gets in the way */}
          {!!text.trim() && (
            <button className="primary" onClick={() => submit()}>
              聞く
            </button>
          )}
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
          <p className="hint">よく聞かれる質問</p>
          {EXAMPLES.map(([icon, q]) => (
            <button key={q} className="chip example-chip" onClick={() => submit(q)}>
              <Icon of={icon} /> {q}
            </button>
          ))}
          {/* a judge opens this screen first: the sample shows what one answer is made of, so it starts open */}
          <details className="sample-fold" open={getTrial()}>
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
          {/* no conclusion over an answer with no law, card or calculation behind it (also an answer saved before the server stopped writing one) */}
          {answer.conclusion && answer.grounded && (
            <div className="conclusion">
              <span className="conclusion-tag">結論</span>
              <p>{answer.conclusion}</p>
              <span className="src-meta">下の答えをまとめたものです。根拠は下の文で確かめてください。</span>
            </div>
          )}
          {/* right under the conclusion: someone who reads only the top still sees it */}
          {answer.safetyNote && <Notice>⚠️ {answer.safetyNote}</Notice>}
          {/* drawn by the program from the numbers of the checked articles and of the calculations (nothing for other answers) */}
          <AnswerDiagrams answer={answer} />
          {/* a tester went to look it up on the internet: the way to check is already here */}
          {answer.sentences.some((s) => s.source === "law") && (
            <div className="how-to-check">
              <span className="htc-title">🔍 確かめ方</span>
              {/* the judges should see what Claude does and what the program checks after it */}
              <span className="htc-who">Claude が条文を選んで答え → プログラムが引用を国の原文と照合</span>
              <span>
                <b>📜 引用元</b> 押すと国の原文
              </span>
              <span>
                <b>✔ 引用が一致</b> 引用した部分が原文と一字一句同じ（文は AI のまとめ）
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
              // the same counts as the line above the answer: laws and cards, not sentences
              const count = src === "wisdom" ? `カード${new Set(rows.map((r) => r.cardId)).size}枚から` : src === "law" ? `${new Set(rows.map((r) => r.lawId)).size}件` : `${rows.length}件`;
              const quoted = rows.filter((r) => r.quote).length;
              const matched = rows.filter((r) => r.verified).length;
              return (
                <Fragment key={src}>
                  <motion.div className={`src-group src-${src}`} variants={GROUP}>
                    <div className="src-head">
                      <span className="src-tag">
                        <Icon of={SOURCE_LABEL[src].icon} /> {SOURCE_LABEL[src].label} {count}
                      </span>
                      {src === "law" && matched > 0 && <Stamp n={matched} of={quoted} />}
                    </div>
                    {shownRows.map((s, i) => {
                        const c = s.source === "wisdom" ? cardOf(s.cardId) : undefined;
                        const law = s.source === "law" ? answer.laws.find((l) => l.id === s.lawId) : undefined;
                        // say whose story it is once per run of sentences from the same card
                        const newCard = c && rows[i - 1]?.cardId !== s.cardId;
                        return (
                          <motion.div key={i} className="src-row" variants={SENTENCE} initial={src === "general" ? "hidden" : undefined} animate={src === "general" ? "shown" : undefined}>
                            {newCard && mine.has(c.id) && <p className="own-words">🧪 いま、あなたが話した言葉です</p>}
                            <p>
                              <Glossed text={s.text} marks={glossMarks[ordered.indexOf(s)] ?? []} onOpen={(t) => setGloss(meaningsFor(t, answerLawIds))} />
                            </p>
                            {newCard && (
                              <p className="src-meta">
                                {c.author}の話{c.publishedAt ? `・${fmtDate(c.publishedAt)}` : ""}
                                {c.triggerAskerName ? `（きっかけ: ${c.triggerAskerName}さんの質問）` : ""}
                                <LawCheckBadge check={c.lawCheck} to={c.lawRefs?.length ? linksId : undefined} />
                              </p>
                            )}
                            {newCard && <SpecNote sentences={c.specDiffers} />}
                            {law && (
                              <div className="cite-line">
                                <button className="cite-chip" onClick={() => setOpenLaw({ id: law.id, quote: s.quote })} title={s.quote}>
                                  📜 引用元：{law.short} {law.article} ›
                                </button>
                                {/* only the quote is checked word for word; the sentence is the AI's reading of it */}
                                {s.verified && <span className="match-mark">✔ 引用が一致</span>}
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
                  {/* right under the green group, open from the start: from the veteran's words to the article */}
                  {src === "wisdom" && lawLinks.length > 0 && (
                    <motion.div variants={GROUP}>
                      <LawLinks id={linksId} links={lawLinks} />
                    </motion.div>
                  )}
                </Fragment>
              );
            })}
          </motion.div>

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
            <button className={answer.grounded ? "secondary" : "primary"} disabled={sent || !!boxHeld} onClick={sendToBox}>
              {/* the note comes once it is really in (the words are checked first) */}
              {sent ? (sentNote ? "📮 質問箱に入れました" : "📮 送っています…") : "📮 親方に聞く"}
            </button>
            )}
          </div>
          {boxErr && (
            <p className="hint error" role="alert">
              {boxErr}
            </p>
          )}
          {boxHeld && <SendCheck key={boxHeld.text} held={boxHeld} sending={sent} onSend={(q, confirmed, from) => void toBox(q, confirmed, from)} />}
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

  const [held, setHeld] = useState<BoxHeld | null>(null); // held back: the veteran might not understand it

  // confirmed: chosen after the check, not checked again
  async function toBox(q: string, confirmed: boolean, from: DOMRect) {
    setSending(true);
    setErr("");
    try {
      const r = await call<BoxSent>("sendToBox", { text: q, askerName: getName(role), askerRole: role, followUpOf: prevId, ...(confirmed ? { confirmed: true } : {}) });
      const h = heldOf(r, q);
      setHeld(h);
      if (h) return;
      setNote(`「${q}」を、続きの質問として質問箱に入れました。親方が答えると、「わたし」に届きます。`);
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
        <button className="secondary" disabled={!text.trim() || sending || !!held} onClick={(e) => void toBox(text.trim(), false, e.currentTarget.getBoundingClientRect())}>
          📮 親方に続けて聞く
        </button>
      </div>
      {/* 自分で書き直す: the words are still in the box above */}
      {held && <SendCheck key={held.text} held={held} sending={sending} onSend={(q, confirmed, from) => void toBox(q, confirmed, from)} onRewrite={() => setHeld(null)} />}
      {err && <p className="hint error">{err}</p>}
      {note && <p className="hint sent-note">{note}</p>}
      {envelope}
    </div>
  );
}
