import { useCallback, useEffect, useRef, useState } from "react";
import { CardBirth, IntoTheBag } from "../CardMotion";
import { call, errorText } from "../firebase";
import { getName, getTrial, setName } from "../local";
import { MicInput, Notice } from "../components";
import { canSay, hush, say, unlockSay } from "../speech";
import { LawCheckPanel, SpecNote, type LawCheckResult, type LawCheckState } from "../LawCheck";
import { PlainNote } from "../Glossary";

/** The card as young workers would get it (publishCard with preview): the ⚠️ / 🔍 sentences against a law taken out. */
type YoungView = {
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  terms?: { word: string; meaning: string }[];
  plain?: string;
  specDiffers: { field: string; text: string }[];
};

type Turn = { role: "veteran" | "ai"; text: string };
interface Draft {
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  tags: string[];
  // the AI's meanings of the veteran's own words, and the card in standard Japanese (see functions/src/interview.ts)
  terms?: { word: string; meaning: string }[];
  plain?: string;
}
export interface Topic {
  questionId: string;
  text: string;
  askerName: string;
  hasPhoto?: boolean; // false: no photo to load (unknown when a draft is opened again: then asked)
  followUp?: { text: string; cardTitle: string | null } | null; // the earlier question and card it follows
}

// 話す with nothing said yet: a blank box stops a veteran, a question to answer does not
const STARTERS = [
  "新人の頃に失敗して、覚えたことは何ですか？",
  "新人によく注意することは何ですか？",
  "この道具、新人はどう間違えますか？",
  "お客さんの家でヒヤッとしたことはありますか？",
  "図面どおりにいかなかった現場で、どうしましたか？",
  "段取りで、これだけはやっておくことは？",
  "検査や点検で、必ず見る所はどこですか？",
  "材料を選ぶ時に、気をつけていることは？",
  "雨の日や寒い日の現場で、気をつけることは？",
  "先輩から教わって、今も守っていることは？",
];
const STARTERS_SHOWN = 3;
/** Up to this many lines of the talk are shown as they are when fixing a card (4 exchanges); a longer one folds the middle. */
const TOLD_OPEN = 8;
// 審査員モード: a story to send, for a judge who has none of their own
const SAMPLE_STORY = "PF管はな、90度の曲がりが3つあったら線が通らん。そん時は途中にプルボックスを入れる。新人は無理に引っぱって、線の被覆を傷めることが多いけん、通らんと思ったら手を止めさせよる。";
// the listener asks back after the sample story: a judge has no site's answer of their own
const SAMPLE_REPLY = "曲がりが多いと引っぱる力が強くなって、被覆がむける。だけん、通らんと思ったら手を止めさせて、プルボックスを足させる。";
// a young worker's question the sample story's card answers (審査員モード: to see the card in an answer)
const SAMPLE_QUESTION = "PF管の曲がりが多くて、線が通らない時はどうする？";

// 話す's story so far, kept for this tab: an iPhone may close a home-screen app while another app is used
const KEEP_KEY = "oyakata.talkKeep";
interface Kept {
  turns: Turn[];
  text: string;
  aiQuestion: string;
  topic: Topic | null;
}
function readKept(): Kept | null {
  try {
    const k = JSON.parse(sessionStorage.getItem(KEEP_KEY) ?? "null") as Kept | null;
    return k && Array.isArray(k.turns) && (k.turns.length > 0 || !!k.text?.trim()) ? k : null;
  } catch {
    return null;
  }
}
function writeKept(k: Kept | null) {
  try {
    if (k) sessionStorage.setItem(KEEP_KEY, JSON.stringify(k));
    else sessionStorage.removeItem(KEEP_KEY);
  } catch {
    // a private window: the story is only in memory, as before
  }
}
// asked only when the page was opened again: a later 話す (after 「新しく話す」 etc.) starts a new story
let firstOpen = true;

export function Talk({
  topic: topicIn,
  resumeCardId,
  active = true,
  onDone,
  onBack,
  boxOpen = 0,
  onOpenBox,
  onDirty,
  onTryAsYoung,
  lead,
}: {
  topic: Topic | null;
  resumeCardId?: string | null;
  active?: boolean; // false while another tab is shown (this screen stays mounted)
  onDone: () => void;
  onBack?: () => void; // opened from わたしのカード: going back there is where the veteran came from
  boxOpen?: number; // young workers' questions waiting in 質問箱: answering them starts there, not here
  onOpenBox?: () => void;
  onDirty?: (dirty: boolean) => void; // something told or edited that is not published yet
  onTryAsYoung?: (question: string) => void; // 審査員モード: ask as a young worker, to see the card in the answer
  lead?: React.ReactNode; // on top of a 話す with nothing told yet: the young worker's question that waited longest
}) {
  const [topic, setTopic] = useState(topicIn);
  const [listenerMode, setListenerMode] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  // a question the young did not send has no question to point at: the listener asks it, so it is in what was told
  const [aiQuestion, setAiQuestion] = useState(topicIn && !topicIn.questionId ? `若手から、こんな質問がありました。「${topicIn.text}」現場では、どうしていますか？` : "");
  // 話す is for the veteran's own stories: everyday questions to start from (rotated); the young workers'
  // questions are answered from 質問箱
  const [round, setRound] = useState(0);
  const fresh = !topicIn && !resumeCardId;
  const starters = Array.from({ length: STARTERS_SHOWN }, (_, i) => STARTERS[(round * STARTERS_SHOWN + i) % STARTERS.length]);
  const [busy, setBusy] = useState(!!resumeCardId); // opening a saved card
  const [err, setErr] = useState("");
  const [cardId, setCardId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [name, setNameState] = useState(getName("veteran"));
  // with no name to show, 「出さない」 is the honest default (an empty name is shown as 社内のベテラン anyway)
  const [showName, setShowName] = useState(!!getName("veteran").trim());
  const [published, setPublished] = useState(false);
  // numbers the draft has that the talk did not, and numbers no law has: for the veteran to check (nothing is blocked)
  const [checkNotes, setCheckNotes] = useState<string[]>([]);
  // the card's sentences against the articles (LawCheck.tsx): the last check of an opened card, the ⚠️ / 🔍
  // sentences still on the card (young workers do not see them: asked about once more before publishing), and
  // whether the card is checked as it is now (only then can it be published)
  const [lawInit, setLawInit] = useState<LawCheckResult | null>(null);
  const [lawLeft, setLawLeft] = useState<string[]>([]);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]); // the listener's questions turned down for this answer
  const [swapping, setSwapping] = useState(false);
  const [swapNote, setSwapNote] = useState(""); // the field 自分で書き直す went to
  const [lawState, setLawState] = useState<LawCheckState>({ checked: false, busy: false, failed: false });
  const [preview, setPreview] = useState<YoungView | null>(null); // 「若手にはこう見えます」, before publishing
  const runCheck = useRef<(() => void) | null>(null);
  const checkBox = useRef<HTMLDivElement>(null);
  const [birth, setBirth] = useState(false); // a new draft is shown being made before it can be edited
  const endBirth = useCallback(() => setBirth(false), []);
  const [status, setStatus] = useState<"draft" | "published" | "private">("draft");
  const [savedStatus, setSavedStatus] = useState<"published" | "private">("published");
  // the card as last saved on the server (a new draft is saved when made): only changes since then would be lost
  const [saved, setSaved] = useState("");
  const snapshot = JSON.stringify([draft, tagsText, showName, name]);

  const dirty = !published && (draft ? snapshot !== saved : turns.length > 0 || !!text.trim());
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  // while the mic is on, nothing is sent or read out (the mic would hear it; words not yet written would be lost)
  const [listening, setListening] = useState(false);

  // a story left half told when the page was closed: asked before anything else
  const [kept, setKept] = useState<Kept | null>(() => (firstOpen && fresh ? readKept() : null));
  useEffect(() => {
    firstOpen = false;
  }, []);
  useEffect(() => {
    if (kept) return; // not answered yet: what is kept stays
    writeKept(!draft && !published && (turns.length > 0 || !!text.trim()) ? { turns, text, aiQuestion, topic } : null);
  }, [kept, draft, published, turns, text, aiQuestion, topic]);
  const restore = (k: Kept) => {
    unlockSay(); // this press lets the question be read out again
    setTurns(k.turns);
    setText(k.text);
    setAiQuestion(k.aiQuestion);
    setTopic(k.topic);
    setKept(null);
  };

  // the interview behind an opened card (a new draft uses the turns of this session)
  const [told, setTold] = useState<Turn[]>([]);
  // opened from わたしのカード: go on with a draft (or fix a published card)
  useEffect(() => {
    if (!resumeCardId) return;
    call<{ cardId: string; status: "draft" | "published" | "private"; draft: Draft; authorName: string; showAuthorName: boolean; topic: { questionId: string; text: string; askerName: string } | null; transcript: Turn[]; lawCheck?: LawCheckResult | null }>("myCard", { cardId: resumeCardId })
      .then((r) => {
        setLawInit(r.lawCheck ?? null);
        setCardId(r.cardId);
        setStatus(r.status);
        setDraft(r.draft);
        setTagsText(r.draft.tags.join("、"));
        setShowName(r.showAuthorName);
        if (r.authorName) setNameState(r.authorName);
        setSaved(JSON.stringify([r.draft, r.draft.tags.join("、"), r.showAuthorName, r.authorName || name]));
        if (r.topic) setTopic(r.topic);
        setTold(r.transcript ?? []);
      })
      .catch((e) => setErr(errorText(e, "カードを開けませんでした。もう一度お試しください。")))
      .finally(() => setBusy(false));
  }, [resumeCardId]);

  const toldShown = turns.length ? turns : told;
  // the young worker's photo, to look at again while telling and while checking the draft
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoPart, setPhotoPart] = useState<string | null>(null); // what ⑤撮る's AI took it for: the question may not fit the photo
  const [photoBig, setPhotoBig] = useState(false);
  const photoQuestion = topic?.hasPhoto === false ? "" : (topic?.questionId ?? "");
  useEffect(() => {
    if (!photoQuestion) return;
    let live = true;
    call<{ photo: string | null; photoPart: string | null }>("questionPhoto", { questionId: photoQuestion })
      .then((r) => {
        if (!live) return;
        setPhoto(r.photo);
        setPhotoPart(r.photo ? r.photoPart : null);
      })
      .catch(() => {}); // the question still shows; only the photo is missing
    return () => {
      live = false;
    };
  }, [photoQuestion]);
  const topicNote = topic && (
    <Notice>
      {topic.followUp && (
        <span className="follow-chip">
          🔗 続き：前の質問「{topic.followUp.text}」{topic.followUp.cardTitle ? `→ カード「${topic.followUp.cardTitle}」` : ""}
        </span>
      )}
      {topic.questionId ? `📮 ${topic.askerName}さんの質問に答えます：` : "🤖 AIだけで答えた質問に答えます："}
      <strong>{topic.text}</strong>
      {/* the young worker's own question is not read out by itself (only the listener's are) */}
      {topic.questionId && canSay() && !listening && (
        <button
          className="link"
          onClick={() => {
            unlockSay();
            say(`${topic.askerName}さんの質問です。${topic.text}`);
          }}
        >
          🔊 質問を聞く
        </button>
      )}
      {photo && (
        <button className={`topic-photo ${photoBig ? "big" : ""}`} onClick={() => setPhotoBig((b) => !b)} aria-label={photoBig ? "写真を小さくする" : "写真を大きくする"}>
          <img src={photo} alt={`${topic.askerName}さんが撮った写真`} />
          <span>{photoBig ? "押すと小さくなります" : "押すと大きくなります"}</span>
        </button>
      )}
      {photoPart && <span className="src-meta">📷 写真の物（AIの判定）：{photoPart}</span>}
    </Notice>
  );

  // the listener's question is read out as it comes (not when the young read it out for the veteran)
  useEffect(() => {
    if (aiQuestion && active && !listenerMode && !listening) say(aiQuestion);
  }, [aiQuestion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) hush();
  }, [active]);
  useEffect(() => hush, []);

  const topicText = () => topic && `${topic.followUp ? `前の質問「${topic.followUp.text}」の続きです。` : ""}${topic.text}${photoPart ? `（写真の物は、AIの判定では「${photoPart}」）` : ""}`;

  // 🔄 ほかの質問にする: the listener asks something else; a question turned down is never put in the talk
  async function otherQuestion() {
    if (!aiQuestion || !turns.length) return;
    const skip = [...skipped, aiQuestion].slice(-5);
    setSwapping(true);
    setErr("");
    try {
      const r = await call<{ done: boolean; question: string }>("interviewNext", { transcript: turns, questionText: topicText(), skip });
      setSkipped(skip);
      if (r.done || !r.question) {
        setAiQuestion("");
        setSwapNote("もう十分に聞けました。下の「ここまでの話をカードにする」を押してください。");
      } else {
        hush();
        setAiQuestion(r.question);
      }
    } catch (e) {
      setErr(errorText(e, "別の質問を出せませんでした。もう一度お試しください。"));
    } finally {
      setSwapping(false);
    }
  }

  // said: what the one-press 「話し終わった」 sends (the box's text may not be updated yet)
  async function next(finish = false, said = text) {
    const t: Turn[] = said.trim()
      ? [...turns, ...(aiQuestion ? [{ role: "ai" as const, text: aiQuestion }] : []), { role: "veteran", text: said.trim() }]
      : turns;
    if (!t.some((x) => x.role === "veteran")) return;
    if (said.trim().length > 3000) {
      setErr("1回に送れるのは3000字までです。分けて送ってください。");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = finish
        ? { done: true, question: "" }
        : await call<{ done: boolean; question: string }>("interviewNext", { transcript: t, questionText: topicText() });
      // only now: if the call failed, what was said stays in the box and can be sent again
      setTurns(t);
      setSkipped([]);
      setSwapNote("");
      setText("");
      setAiQuestion("");
      if (!r.done) {
        setAiQuestion(r.question);
      } else {
        const d = await call<{ cardId: string; draft: Draft; unsaidNumbers?: string[]; unsaidSentences?: string[]; lawNotes?: string[] }>("draftCard", {
          transcript: t,
          authorName: name,
          triggerQuestionId: topic?.questionId || undefined,
        });
        setCardId(d.cardId);
        setCheckNotes([
          ...(d.unsaidSentences ?? []).map((x) => `話していない中身があるかもしれない文：「${x}」（AIが足したり言い換えたりしたかもしれません。消すか残すか決めてください）`),
          ...(d.unsaidNumbers?.length ? [`話に無い数値があります：${d.unsaidNumbers.join("、")}（AIが足したかもしれません）`] : []),
          ...(d.lawNotes ?? []),
        ]);
        setDraft(d.draft);
        setBirth(true);
        setTagsText(d.draft.tags.join("、"));
        setSaved(JSON.stringify([d.draft, d.draft.tags.join("、"), showName, name]));
      }
    } catch (e) {
      setErr(errorText(e, "うまく送れませんでした。もう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  // seen = the veteran has looked at 「若手にはこう見えます」 and said yes
  async function publish(seen = false) {
    if (!draft) return;
    if (!lawState.checked) return; // the server refuses it too
    const data = {
      cardId,
      authorName: name,
      showAuthorName: showName,
      edits: { ...draft, tags: tagsText.split(/[、,\n]+/).map((x) => x.trim()).filter(Boolean) }, // a word may keep its spaces (「VVF 2.0」)
    };
    setBusy(true);
    setErr("");
    try {
      // a sentence the check marked ⚠️ / 🔍 against a law does not reach young workers. What is left may read
      // differently on its own (「…付け替えればよか」 without 「資格がなくても」), so the veteran sees it first.
      if (lawLeft.length && !seen) {
        const p = await call<{ preview: YoungView }>("publishCard", { ...data, preview: true });
        setPreview(p.preview);
        window.scrollTo({ top: 0 });
        return;
      }
      setName("veteran", name);
      const r = await call<{ status?: "published" | "private"; lawNotes?: string[]; hidden?: number }>("publishCard", data);
      setPreview(null);
      // what the card is now (it may have been made public or hidden from わたしのカード meanwhile)
      setSavedStatus(r.status ?? "published");
      setCheckNotes([
        ...(r.hidden ? [`条文と違う（または確かめられない）${r.hidden}つの文は、若手には表示していません。「わたしのカード」から、言い回しを変えて照らし直せます。`] : []),
        ...(r.lawNotes ?? []),
      ]);
      setPublished(true);
    } catch (e) {
      setErr(errorText(e, "保存できませんでした。題名とやり方が入っているか、長すぎないか確かめてください。"));
    } finally {
      setBusy(false);
    }
  }

  const back = resumeCardId ? onBack : undefined;
  // opened from 質問箱 (a question sent there, or one only the AI answered): going back there
  const fromBox = !!topicIn && !resumeCardId && !!onOpenBox;
  const toBox = () => {
    onDone();
    onOpenBox?.();
  };
  const leave = back ?? (fromBox ? toBox : undefined);
  const leaveTo = back ? "わたしのカードへ戻る" : fromBox ? "質問箱に戻る" : "新しく話す";
  const leaveAsk = back || fromBox ? "戻りますか？" : "新しく話しますか？";

  if (published) {
    return (
      <section className="screen center">
        {savedStatus === "published" && status === "draft" && draft ? <IntoTheBag title={draft.title} /> : <div className="big-emoji">🗂️</div>}
        <h1 className="screen-title">{savedStatus === "private" ? "直しました（非公開のまま）" : status === "draft" ? "知恵袋に入りました" : "直しました"}</h1>
        {savedStatus !== "private" && <p>若手が聞けば、あなたの話が答えに出てきます。{status === "draft" && topic?.questionId && `${topic.askerName}さんにも届きます。`}</p>}
        {back ? (
          <>
            <button className="primary" onClick={back}>
              ← わたしのカードへ戻る
            </button>
            <button className="link" onClick={onDone}>
              新しく話す
            </button>
          </>
        ) : topic?.questionId && onOpenBox ? (
          // answered from 質問箱: the next question waits there
          <>
            <button
              className="primary"
              onClick={() => {
                onDone();
                onOpenBox();
              }}
            >
              📮 質問箱に戻る
            </button>
            <button className="link" onClick={onDone}>
              新しく話す
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onDone}>
              続けて話す
            </button>
            {boxOpen > 0 && onOpenBox && (
              <button
                className="secondary"
                onClick={() => {
                  onDone();
                  onOpenBox();
                }}
              >
                📮 質問箱を見る（{boxOpen}件）
              </button>
            )}
          </>
        )}
        {/* 審査員モード: the other half of the app, where the card just made comes back in an answer */}
        {getTrial() && savedStatus !== "private" && onTryAsYoung && draft && (
          <button
            className="secondary"
            onClick={() => onTryAsYoung(toldShown.some((t) => t.text === SAMPLE_STORY) ? SAMPLE_QUESTION : `${draft.title}は、どうすればいい？`)}
          >
            🔰 若手として聞いてみる →
          </button>
        )}
        {checkNotes.length > 0 && <CheckNotes notes={checkNotes} />}
        {savedStatus !== "private" && <p className="hint">あとで「わたしのカード」から直したり、非公開に戻したりできます。</p>}
      </section>
    );
  }

  if (draft && preview) {
    const parts: [Exclude<keyof YoungView, "specDiffers" | "terms" | "plain">, string][] = [
      ["title", "一言でいうと"],
      ["scene", "どんな現場・場面で"],
      ["body", "やり方・コツ"],
      ["reason", "なぜそうするか／やらかした失敗"],
      ["caution", "新人がよく間違えること"],
    ];
    return (
      <section className="screen">
        <h1 className="screen-title">若手にはこう見えます</h1>
        <Notice>条文と違う所があります。この文は若手には表示されません。取り消すか、言い回しを変えてもう一度照らしてください。（このまま公開すると、この文以外が若手に届きます）</Notice>
        <p className="hint">若手にはこう見えます。残った文だけで、意味が変わっていないか確かめてください。</p>
        <article className="wisdom-card">
          {parts.map(([k, label]) =>
            preview[k] ? (
              <div className="wc-part" key={k}>
                <span>{label}</span>
                <p>{preview[k]}</p>
              </div>
            ) : null,
          )}
          {/* the meanings and the standard-Japanese wording young workers get (those marked ⚠️ / 🔍 are not here) */}
          {!!preview.terms?.length && (
            <div className="wc-part">
              <span>言葉の意味</span>
              <ul className="field-words-list">
                {preview.terms.map((t) => (
                  <li key={t.word}>
                    <b>{t.word}</b>：{t.meaning}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <PlainNote plain={preview.plain} />
          <SpecNote sentences={preview.specDiffers} />
        </article>
        <details className="told">
          <summary>若手には表示しない文（{lawLeft.length}つ）</summary>
          <ul>
            {lawLeft.map((t, i) => (
              <li key={i}>「{t}」</li>
            ))}
          </ul>
        </details>
        {err && <p className="hint error">{err}</p>}
        <button className="primary" disabled={busy} onClick={() => publish(true)}>
          {busy ? "保存しています…" : status === "private" ? "この内容で保存する" : "この内容で公開する"}
        </button>
        <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>
          戻って直す
        </button>
      </section>
    );
  }

  if (draft && birth) {
    return <CardBirth said={turns.filter((t) => t.role === "veteran").map((t) => t.text)} draft={draft} onDone={endBirth} />;
  }

  if (draft) {
    // the same limits as the server (functions/src/interview.ts CARD_LIMITS)
    const MAX: Record<string, number> = { title: 60, scene: 500, body: 1500, reason: 1000, caution: 1000 };
    // 自分で書き直す took the veteran to a field: 「もう一度照らす」 waits right there, not back down at the check
    const againButton = (
      <button
        type="button"
        className="secondary law-again-here"
        onClick={(e) => {
          e.preventDefault();
          setRewriting(null);
          runCheck.current?.();
          checkBox.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        }}
      >
        ⚖️ 直したので、もう一度照らす
      </button>
    );
    const field = (key: keyof Draft, label: string, rows = 2) => (
      <label className="field">
        <span>{label}</span>
        <textarea data-field={key} rows={rows} maxLength={MAX[key]} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        {rewriting === key && againButton}
      </label>
    );
    return (
      <section className="screen">
        <h1 className="screen-title">{status === "draft" ? "知恵カードの下書き" : "知恵カードを直す"}</h1>
        {topicNote}
        {toldShown.length > 0 && (
          // open from the start: fixing a card later, the veteran needs to see what was asked and said (a closed
          // box went unnoticed). A long talk shows the first question and the last two exchanges; the rest opens.
          <section className="told" aria-label="このカードのもとになった話">
            <h2 className="told-title">🎙️ このカードのもとになった話</h2>
            {(() => {
              const long = toldShown.length > TOLD_OPEN;
              const head = long ? toldShown.slice(0, 1) : toldShown;
              const mid = long ? toldShown.slice(1, -4) : [];
              const tail = long ? toldShown.slice(-4) : [];
              const row = (x: Turn, i: number) => (
                <li key={i} className={x.role}>
                  <span className="who">{x.role === "ai" ? "AI" : "あなた"}</span>
                  {x.text}
                </li>
              );
              return (
                <>
                  <ol className="transcript">{head.map(row)}</ol>
                  {mid.length > 0 && (
                    <details>
                      <summary>途中のやりとりを全部見る（{mid.length}件）</summary>
                      <ol className="transcript">{mid.map(row)}</ol>
                    </details>
                  )}
                  {tail.length > 0 && <ol className="transcript">{tail.map(row)}</ol>}
                </>
              );
            })()}
          </section>
        )}
        <p className="hint">
          {status === "draft"
            ? "中身を確かめてください。直してから公開できます。公開するまで、誰にも見えません。"
            : status === "private"
              ? "非公開のカードです。直しても非公開のままです（保存してから「わたしのカード」で公開できます）。"
              : "公開中のカードです。直すと、すぐに答えにも反映されます。"}
        </p>
        {checkNotes.length > 0 && <CheckNotes notes={checkNotes} />}
        {field("title", "一言でいうと", 1)}
        {field("scene", "どんな現場・場面で")}
        {field("body", "やり方・コツ", 3)}
        {field("reason", "なぜそうするか／やらかした失敗", 3)}
        {field("caution", "新人がよく間違えること")}
        <label className="field">
          <span>探す時の言葉（現場の呼び名など）</span>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </label>
        <FieldWords draft={draft} onChange={setDraft} />
        {(rewriting === "plain" || rewriting === "terms") && againButton}
        {cardId && (
          <div ref={checkBox}>
            <LawCheckPanel
              key={cardId}
              cardId={cardId}
              card={draft}
              tags={tagsText.split(/[、,\n]+/).map((x) => x.trim()).filter(Boolean)}
              initial={lawInit}
              onEdit={(patch) => setDraft((d) => d && { ...d, ...patch })}
              onLeft={setLawLeft}
              onState={setLawState}
              runRef={runCheck}
              onRewrite={setRewriting}
            />
          </div>
        )}
        <fieldset className="field">
          <legend>名前の出し方</legend>
          <label className="radio">
            <input type="radio" name="showName" checked={showName} onChange={() => setShowName(true)} /> 名前を出す
          </label>
          {showName && <input placeholder="例: 山田（親方）" maxLength={30} value={name} onChange={(e) => setNameState(e.target.value)} />}
          {showName && !name.trim() && <p className="hint">名前が空のままだと「社内のベテラン」と表示されます。</p>}
          <label className="radio">
            <input type="radio" name="showName" checked={!showName} onChange={() => setShowName(false)} /> 出さない（「社内のベテラン」と表示）
          </label>
        </fieldset>
        {err && <p className="hint error">{err}</p>}
        <button className="primary" disabled={busy || !lawState.checked || !draft.title.trim() || !draft.body.trim()} onClick={() => publish()}>
          {busy ? "保存しています…" : status === "draft" ? "確かめたので公開する" : "直して保存する"}
        </button>
        {/* only a card checked as it is now goes out (publishCard refuses others) */}
        {cardId && !lawState.checked && (
          <p className="hint publish-gate">
            {lawState.busy ? (
              "条文と照らしています。終わると公開できます。"
            ) : (
              <>
                条文との照らし合わせをしてから公開してください。{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    checkBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    runCheck.current?.();
                  }}
                >
                  {lawState.failed ? "もう一度照らす" : "照らす"}
                </button>
              </>
            )}
          </p>
        )}
        {status === "draft" && <p className="hint">公開したあとも、「わたしのカード」で非公開に戻せます。</p>}
        <button
          className="link"
          disabled={busy}
          onClick={() =>
            confirm(
              dirty
                ? status === "draft"
                  ? `直した所は保存されません（下書きは直す前のまま「わたしのカード」に残ります）。${leaveAsk}`
                  : `直した所は保存されません。${leaveAsk}`
                : `この下書きは「わたしのカード」に残ります。${leaveAsk}`,
            ) && (leave ?? onDone)()
          }
        >
          {status === "draft" ? `下書きのまま置いて、${leaveTo}` : `保存しないで、${leaveTo}`}
        </button>
      </section>
    );
  }

  // 話す first: the mic comes right under the question; the ways to start and the promises go below it
  const blank = fresh && !turns.length && !aiQuestion && !text.trim();
  if (kept) {
    return (
      <section className="screen">
        <h1 className="screen-title">話の途中があります</h1>
        <Notice>
          前に話していた途中が残っています（やりとり{kept.turns.filter((t) => t.role === "veteran").length}回）。続きから話しますか？
          {kept.topic && (
            <>
              <br />
              <strong>{kept.topic.text}</strong>
            </>
          )}
        </Notice>
        <button className="primary" onClick={() => restore(kept)}>
          続きから話す
        </button>
        <button className="link" onClick={() => setKept(null)}>
          消して、新しく話す
        </button>
      </section>
    );
  }
  // 審査員モード, right after the sample story: the listener asks back, and a judge has nothing to answer with
  const sampleTold = getTrial() && turns.some((t) => t.text === SAMPLE_STORY) && turns.filter((t) => t.role === "veteran").length === 1;
  return (
    <section className="screen">
      {fromBox && (
        <button className="link back-link" disabled={busy} onClick={() => (!dirty || confirm("話している途中の内容は消えます。質問箱に戻りますか？")) && toBox()}>
          ← 質問箱に戻る
        </button>
      )}
      {topicNote}
      {/* a judge without a site's story to tell can still see the interview. On top, so the question box's card that
          loads a moment later cannot push it down under the judge's finger */}
      {blank && getTrial() && (
        <button className="secondary" onClick={() => setText(SAMPLE_STORY)}>
          🧪 見本の話で試す
        </button>
      )}
      {blank && lead}

      {turns.length > 0 && (
        <ol className="transcript">
          {turns.map((t, i) => (
            <li key={i} className={t.role}>
              <span className="who">{t.role === "ai" ? "聞き手" : "あなた"}</span>
              {t.text}
            </li>
          ))}
        </ol>
      )}

      {fresh && !turns.length && !aiQuestion && (
        <>
          <h1 className="screen-title">現場の話を、聞かせてください</h1>
          <p className="talk-either">話しても、文字で書いても大丈夫です</p>
        </>
      )}
      {swapNote && !aiQuestion && <p className="hint">{swapNote}</p>}

      {aiQuestion && (
        <div className="ai-question">
          <span className="src-tag">{listenerMode ? "📣 親方に読み上げてください（聞き手：Claude）" : "🤖 聞き手（Claude）から"}</span>
          <p>{aiQuestion}</p>
          {canSay() && !listenerMode && !listening && (
            <button className="link" onClick={() => say(aiQuestion)}>
              🔊 もう一度聞く
            </button>
          )}
          {turns.length > 0 && !listening && (
            <button className="link" disabled={swapping || busy} onClick={() => void otherQuestion()}>
              {swapping ? "別の質問を考えています…" : "🔄 ほかの質問にする"}
            </button>
          )}
          {fresh && !turns.length && (
            <button
              className="link"
              onClick={() => {
                hush(); // the question being taken away is not read on to the end
                setAiQuestion("");
              }}
            >
              ← 別のきっかけにする
            </button>
          )}
        </div>
      )}

      <MicInput
        paused={!active}
        maxLength={3000}
        value={text}
        onChange={setText}
        micLabel={turns.length || topic ? "話して答える" : "話す"}
        typeLabel={turns.length || topic ? "書いて答える" : "書く"}
        onDone={busy ? undefined : (said) => void next(false, said)}
        onListening={setListening}
        send={{ label: turns.length ? "答えを送る" : "話した内容を送る", busy, onSend: () => void next(false) }}
        rows={4}
        placeholder={
          turns.length
            ? "話した内容がここに入ります。文字で書いても大丈夫です"
            : topic
              ? "話すか、ここに書いて答えてください（方言のままで大丈夫）"
              : "ここに文字で書いても大丈夫です。例: PF管はな、90度の曲がりが3つあったら線が通らん。プルボックスを入れる。"
        }
      />
      {(aiQuestion || topic) && !listening && (
        // a veteran answering felt unsure whether what they said was right: the check comes after, and they decide
        <p className="hint talk-sure">📖 うろ覚えでも大丈夫です。カードにしたあと条文と照らして、違う所はお知らせします。公開するかは親方が決めます。</p>
      )}
      {err && <p className="hint error">{err}</p>}
      {/* the send button is MicInput's: above the text once something was said, so the iPhone keyboard cannot hide it.
          Not while listening: the mic's own 「話し終わった（送る）」 sends then, with the last words */}
      {sampleTold && !busy && !listening && !text.trim() && (
        <>
          <button className="secondary" onClick={() => setText(SAMPLE_REPLY)}>
            🧪 見本の答えを入れる
          </button>
          <p className="hint">見本は、ここで下の「ここまでの話をカードにする」を押しても大丈夫です。</p>
        </>
      )}

      {blank && (
        <div className="talk-seeds">
          {boxOpen > 0 && onOpenBox && !lead && (
            <button className="seed young-q" onClick={onOpenBox}>
              📮 質問箱に若手の質問が{boxOpen}件あります →
            </button>
          )}
          <p className="part-sub">🎙️ 何から話しますか？ 押すと、聞き手がその質問から始めます</p>
          {starters.map((q) => (
            <button key={q} className="seed" onClick={() => {
                unlockSay();
                setAiQuestion(q);
              }}>
              {q}
            </button>
          ))}
          <button className="link" onClick={() => setRound((r) => r + 1)}>
            別のきっかけ ↻
          </button>
          <p className="hint">押さずに、思いついたことをそのまま話しても大丈夫です。</p>
        </div>
      )}

      {/* away from 「答えを送る」: a wrong press would end the interview */}
      {turns.length > 0 && (
        <div className="finish-talk">
          {/* while listening, the last words are not written yet: they would be left out of the card */}
          <p className="hint">{listening ? "🎤を止めてから押せます" : "話し終えたら"}</p>
          <button className="secondary" disabled={busy || listening} onClick={() => confirm("ここまでの話で、知恵カードの下書きを作りますか？（下書きは、公開する前に直せます）") && next(true)}>
            🗂️ ここまでの話をカードにする
          </button>
        </div>
      )}

      <label className="toggle small">
        <input type="checkbox" checked={listenerMode} onChange={(e) => setListenerMode(e.target.checked)} />
        👥 若手と2人で使う
        <details className="more-info">
          <summary>？</summary>
          若手がスマホを持ち、AIの質問を親方に読み上げます。親方はスマホに触らず、話すだけです。
        </details>
      </label>

      <ul className="promise-chips" aria-label="安心の約束">
        <li title="声は残しません。文字だけを使います">🔇 声は残さない</li>
        <li title="方言・話し言葉のままで大丈夫です">🗣️ 方言のままOK</li>
        <li title="あなたが確かめるまで、公開しません">🔒 確かめるまで非公開</li>
        <li title="名前を出すかどうか、毎回選べます">👤 名前は選べる</li>
      </ul>
    </section>
  );
}

function CheckNotes({ notes }: { notes: string[] }) {
  return (
    <div className="check-notes" role="note">
      <strong>🔎 公開の前に確かめてほしい所</strong>
      <ul>
        {notes.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The meanings the AI put on the veteran's own words, to check before publishing: the card's words stay as told,
 * young workers see them underlined. A wrong one is taken off with ✕ (publishCard keeps only what is sent).
 */
function FieldWords({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const terms = draft.terms ?? [];
  if (!terms.length && !draft.plain) return null;
  const text = [draft.title, draft.scene, draft.body, draft.reason, draft.caution].join("\n");
  return (
    <div className="field field-words">
      <span>若手向けに付けた言葉の意味（AI が付けました）</span>
      <p className="hint">カードの文はあなたの言葉のままです。この言葉に下線が付き、押すと意味が出ます。違う時は ✕ で外してください。</p>
      {terms.length > 0 && (
        <ul className="field-words-list">
          {terms.map((t) => (
            <li key={t.word}>
              <span>
                <b>{t.word}</b>：{t.meaning}
                {/* the server keeps only words still written on the card */}
                {!text.includes(t.word) && <span className="src-meta">（文から消えたので、保存すると外れます）</span>}
              </span>
              <button type="button" className="link field-words-x" aria-label={`「${t.word}」の意味を外す`} onClick={() => onChange({ ...draft, terms: terms.filter((x) => x.word !== t.word) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.plain && (
        <div className="field-words-plain">
          <span>
            <b>標準語では：</b>
            {draft.plain}
          </span>
          <button type="button" className="link field-words-x" aria-label="標準語の言い換えを外す" onClick={() => onChange({ ...draft, plain: "" })}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
