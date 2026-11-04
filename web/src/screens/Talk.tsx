import { useCallback, useEffect, useState } from "react";
import { CardBirth, IntoTheBag } from "../CardMotion";
import { call, errorText } from "../firebase";
import { getName, getTrial, setName } from "../local";
import { MicInput, Notice } from "../components";
import { canSay, hush, say } from "../speech";

type Turn = { role: "veteran" | "ai"; text: string };
interface Draft {
  title: string;
  scene: string;
  body: string;
  reason: string;
  caution: string;
  tags: string[];
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
// 審査員モード: a story to send, for a judge who has none of their own
const SAMPLE_STORY = "PF管はな、90度の曲がりが3つあったら線が通らん。そん時は途中にプルボックスを入れる。新人は無理に引っぱって、線の被覆を傷めることが多いけん、通らんと思ったら手を止めさせよる。";

export function Talk({
  topic: topicIn,
  resumeCardId,
  active = true,
  onDone,
  onBack,
  boxOpen = 0,
  onOpenBox,
  onDirty,
}: {
  topic: Topic | null;
  resumeCardId?: string | null;
  active?: boolean; // false while another tab is shown (this screen stays mounted)
  onDone: () => void;
  onBack?: () => void; // opened from わたしのカード: going back there is where the veteran came from
  boxOpen?: number; // young workers' questions waiting in 質問箱: answering them starts there, not here
  onOpenBox?: () => void;
  onDirty?: (dirty: boolean) => void; // something told or edited that is not published yet
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
  const [birth, setBirth] = useState(false); // a new draft is shown being made before it can be edited
  const endBirth = useCallback(() => setBirth(false), []);
  const [status, setStatus] = useState<"draft" | "published" | "private">("draft");
  const [savedStatus, setSavedStatus] = useState<"published" | "private">("published");
  // the card as last saved on the server (a new draft is saved when made): only changes since then would be lost
  const [saved, setSaved] = useState("");
  const snapshot = JSON.stringify([draft, tagsText, showName, name]);

  const dirty = !published && (draft ? snapshot !== saved : turns.length > 0 || !!text.trim());
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  // the interview behind an opened card (a new draft uses the turns of this session)
  const [told, setTold] = useState<Turn[]>([]);
  // opened from わたしのカード: go on with a draft (or fix a published card)
  useEffect(() => {
    if (!resumeCardId) return;
    call<{ cardId: string; status: "draft" | "published" | "private"; draft: Draft; authorName: string; showAuthorName: boolean; topic: { questionId: string; text: string; askerName: string } | null; transcript: Turn[] }>("myCard", { cardId: resumeCardId })
      .then((r) => {
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
    if (aiQuestion && active && !listenerMode) say(aiQuestion);
  }, [aiQuestion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) hush();
  }, [active]);
  useEffect(() => hush, []);

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
        : await call<{ done: boolean; question: string }>("interviewNext", { transcript: t, questionText: topic && `${topic.followUp ? `前の質問「${topic.followUp.text}」の続きです。` : ""}${topic.text}${photoPart ? `（写真の物は、AIの判定では「${photoPart}」）` : ""}` });
      // only now: if the call failed, what was said stays in the box and can be sent again
      setTurns(t);
      setText("");
      setAiQuestion("");
      if (!r.done) {
        setAiQuestion(r.question);
      } else {
        const d = await call<{ cardId: string; draft: Draft }>("draftCard", {
          transcript: t,
          authorName: name,
          triggerQuestionId: topic?.questionId || undefined,
        });
        setCardId(d.cardId);
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

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setErr("");
    try {
      setName("veteran", name);
      const r = await call<{ status?: "published" | "private" }>("publishCard", {
        cardId,
        authorName: name,
        showAuthorName: showName,
        edits: { ...draft, tags: tagsText.split(/[、,\n]+/).map((x) => x.trim()).filter(Boolean) }, // a word may keep its spaces (「VVF 2.0」)
      });
      // what the card is now (it may have been made public or hidden from わたしのカード meanwhile)
      setSavedStatus(r.status ?? "published");
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
        {savedStatus !== "private" && <p className="hint">あとで「わたしのカード」から直したり、非公開に戻したりできます。</p>}
      </section>
    );
  }

  if (draft && birth) {
    return <CardBirth said={turns.filter((t) => t.role === "veteran").map((t) => t.text)} draft={draft} onDone={endBirth} />;
  }

  if (draft) {
    // the same limits as the server (functions/src/interview.ts CARD_LIMITS)
    const MAX: Record<string, number> = { title: 60, scene: 500, body: 1500, reason: 1000, caution: 1000 };
    const field = (key: keyof Draft, label: string, rows = 2) => (
      <label className="field">
        <span>{label}</span>
        <textarea rows={rows} maxLength={MAX[key]} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      </label>
    );
    return (
      <section className="screen">
        <h1 className="screen-title">{status === "draft" ? "知恵カードの下書き" : "知恵カードを直す"}</h1>
        {topicNote}
        {toldShown.length > 0 && (
          <details className="told">
            <summary>🎙️ 聞き取りのやりとり（直す前に、話した内容を確かめる）</summary>
            <ol className="transcript">
              {toldShown.map((x, i) => (
                <li key={i} className={x.role}>
                  <span className="who">{x.role === "ai" ? "AI" : "あなた"}</span>
                  {x.text}
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="hint">
          {status === "draft"
            ? "中身を確かめてください。直してから公開できます。公開するまで、誰にも見えません。"
            : status === "private"
              ? "非公開のカードです。直しても非公開のままです（保存してから「わたしのカード」で公開できます）。"
              : "公開中のカードです。直すと、すぐに答えにも反映されます。"}
        </p>
        {field("title", "一言でいうと", 1)}
        {field("scene", "どんな現場・場面で")}
        {field("body", "やり方・コツ", 3)}
        {field("reason", "なぜそうするか／やらかした失敗", 3)}
        {field("caution", "新人がよく間違えること")}
        <label className="field">
          <span>探す時の言葉（現場の呼び名など）</span>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </label>
        <fieldset className="field">
          <span>名前の出し方</span>
          <label className="radio">
            <input type="radio" checked={showName} onChange={() => setShowName(true)} /> 名前を出す
          </label>
          {showName && <input placeholder="例: 山田（親方）" maxLength={30} value={name} onChange={(e) => setNameState(e.target.value)} />}
          {showName && !name.trim() && <p className="hint">名前が空のままだと「社内のベテラン」と表示されます。</p>}
          <label className="radio">
            <input type="radio" checked={!showName} onChange={() => setShowName(false)} /> 出さない（「社内のベテラン」と表示）
          </label>
        </fieldset>
        {err && <p className="hint error">{err}</p>}
        <button className="primary" disabled={busy || !draft.title.trim() || !draft.body.trim()} onClick={publish}>
          {busy ? "保存しています…" : status === "draft" ? "確かめたので公開する" : "直して保存する"}
        </button>
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
  return (
    <section className="screen">
      {fromBox && (
        <button className="link back-link" disabled={busy} onClick={() => (!dirty || confirm("話している途中の内容は消えます。質問箱に戻りますか？")) && toBox()}>
          ← 質問箱に戻る
        </button>
      )}
      {topicNote}

      {turns.length > 0 && (
        <ol className="transcript">
          {turns.map((t, i) => (
            <li key={i} className={t.role}>
              {t.text}
            </li>
          ))}
        </ol>
      )}

      {fresh && !turns.length && !aiQuestion && <h1 className="screen-title">現場の話を、聞かせてください</h1>}

      {aiQuestion && (
        <div className="ai-question">
          <span className="src-tag">{listenerMode ? "📣 親方に読み上げてください（聞き手：Claude）" : "🤖 聞き手（Claude）から"}</span>
          <p>{aiQuestion}</p>
          {canSay() && !listenerMode && (
            <button className="link" onClick={() => say(aiQuestion)}>
              🔊 もう一度聞く
            </button>
          )}
          {fresh && !turns.length && (
            <button className="link" onClick={() => setAiQuestion("")}>
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
        micLabel={turns.length ? "答える" : "話す"}
        onDone={busy ? undefined : (said) => void next(false, said)}
        rows={4}
        placeholder={turns.length ? "話した内容がここに入ります" : "例: PF管はな、90度の曲がりが3つあったら線が通らん。プルボックスを入れる。"}
      />
      {err && <p className="hint error">{err}</p>}
      {/* shown once something was said: a grey button that cannot be pressed only gets in the way */}
      {(busy || !!text.trim()) && (
        <button className="primary" disabled={busy} onClick={() => next(false)}>
          {busy ? "考えています…" : turns.length ? "答えを送る" : "話した内容を送る"}
        </button>
      )}
      {/* a judge without a site's story to tell can still see the interview */}
      {blank && getTrial() && (
        <button className="secondary" onClick={() => setText(SAMPLE_STORY)}>
          🧪 見本の話で試す
        </button>
      )}

      {blank && (
        <div className="talk-seeds">
          {boxOpen > 0 && onOpenBox && (
            <button className="seed young-q" onClick={onOpenBox}>
              📮 質問箱に若手の質問が{boxOpen}件あります →
            </button>
          )}
          <p className="part-sub">🎙️ 何から話しますか？ 押すと、聞き手がその質問から始めます</p>
          {starters.map((q) => (
            <button key={q} className="seed" onClick={() => setAiQuestion(q)}>
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
          <p className="hint">話し終えたら</p>
          <button className="secondary" disabled={busy} onClick={() => confirm("ここまでの話で、知恵カードの下書きを作りますか？（下書きは、公開する前に直せます）") && next(true)}>
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
