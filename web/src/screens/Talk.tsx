import { useEffect, useState } from "react";
import { call, errorText } from "../firebase";
import { getName, setName } from "../local";
import { MicInput, Notice } from "../components";

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
}

export function Talk({
  topic: topicIn,
  resumeCardId,
  active = true,
  onDone,
  onDirty,
}: {
  topic: Topic | null;
  resumeCardId?: string | null;
  active?: boolean; // false while another tab is shown (this screen stays mounted)
  onDone: () => void;
  onDirty?: (dirty: boolean) => void; // something told or edited that is not published yet
}) {
  const [topic, setTopic] = useState(topicIn);
  const [listenerMode, setListenerMode] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [busy, setBusy] = useState(!!resumeCardId); // opening a saved card
  const [err, setErr] = useState("");
  const [cardId, setCardId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [showName, setShowName] = useState(true);
  const [name, setNameState] = useState(getName("veteran"));
  const [published, setPublished] = useState(false);
  const [status, setStatus] = useState<"draft" | "published" | "private">("draft");
  const [savedStatus, setSavedStatus] = useState<"published" | "private">("published");
  // the card as last saved on the server (a new draft is saved when made): only changes since then would be lost
  const [saved, setSaved] = useState("");
  const snapshot = JSON.stringify([draft, tagsText, showName, name]);

  const dirty = !published && (draft ? snapshot !== saved : turns.length > 0 || !!text.trim());
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  // opened from わたしのカード: go on with a draft (or fix a published card)
  useEffect(() => {
    if (!resumeCardId) return;
    call<{ cardId: string; status: "draft" | "published" | "private"; draft: Draft; authorName: string; showAuthorName: boolean; topic: { text: string; askerName: string } | null }>("myCard", { cardId: resumeCardId })
      .then((r) => {
        setCardId(r.cardId);
        setStatus(r.status);
        setDraft(r.draft);
        setTagsText(r.draft.tags.join("、"));
        setShowName(r.showAuthorName);
        if (r.authorName) setNameState(r.authorName);
        setSaved(JSON.stringify([r.draft, r.draft.tags.join("、"), r.showAuthorName, r.authorName || name]));
        if (r.topic) setTopic({ questionId: "", ...r.topic });
      })
      .catch((e) => setErr(errorText(e, "カードを開けませんでした。もう一度お試しください。")))
      .finally(() => setBusy(false));
  }, [resumeCardId]);

  async function next(finish = false) {
    const t: Turn[] = text.trim()
      ? [...turns, ...(aiQuestion ? [{ role: "ai" as const, text: aiQuestion }] : []), { role: "veteran", text: text.trim() }]
      : turns;
    if (!t.some((x) => x.role === "veteran")) return;
    if (text.trim().length > 3000) {
      setErr("1回に送れるのは3000字までです。分けて送ってください。");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = finish
        ? { done: true, question: "" }
        : await call<{ done: boolean; question: string }>("interviewNext", { transcript: t, questionText: topic?.text });
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
          triggerQuestionId: topic?.questionId,
        });
        setCardId(d.cardId);
        setDraft(d.draft);
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

  if (published) {
    return (
      <section className="screen center">
        <div className="big-emoji">🗂️</div>
        <h1 className="screen-title">{savedStatus === "private" ? "直しました（非公開のまま）" : status === "draft" ? "知恵袋に入りました" : "直しました"}</h1>
        {savedStatus !== "private" && <p>若手が聞けば、あなたの話が答えに出てきます。{status === "draft" && topic && `${topic.askerName}さんにも届きます。`}</p>}
        <button className="primary" onClick={onDone}>
          続けて話す
        </button>
      </section>
    );
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
          <label className="radio">
            <input type="radio" checked={!showName} onChange={() => setShowName(false)} /> 出さない（「社内のベテラン」と表示）
          </label>
        </fieldset>
        {err && <p className="hint error">{err}</p>}
        <button className="primary" disabled={busy || !draft.title.trim() || !draft.body.trim()} onClick={publish}>
          {busy ? "保存しています…" : status === "draft" ? "確かめたので公開する" : "直して保存する"}
        </button>
        <button
          className="link"
          disabled={busy}
          onClick={() =>
            confirm(
              dirty
                ? status === "draft"
                  ? "直した所は保存されません（下書きは直す前のまま「わたしのカード」に残ります）。新しく話しますか？"
                  : "直した所は保存されません。新しく話しますか？"
                : "この下書きは「わたしのカード」に残ります。新しく話しますか？",
            ) && onDone()
          }
        >
          {status === "draft" ? "下書きのまま置いて、新しく話す" : "保存しないで、新しく話す"}
        </button>
      </section>
    );
  }

  return (
    <section className="screen">
      <p className="catch">あなたの一言が、業界の未来へつながる</p>
      {topic && (
        <Notice>
          📮 {topic.askerName}さんの質問に答えます：<strong>{topic.text}</strong>
        </Notice>
      )}

      <label className="toggle">
        <input type="checkbox" checked={listenerMode} onChange={(e) => setListenerMode(e.target.checked)} />
        若手が聞き役（若手がスマホを持ち、質問を読み上げる）
      </label>

      {turns.length > 0 && (
        <ol className="transcript">
          {turns.map((t, i) => (
            <li key={i} className={t.role}>
              {t.text}
            </li>
          ))}
        </ol>
      )}

      {aiQuestion && (
        <div className="ai-question">
          <span className="src-tag">{listenerMode ? "📣 親方に読み上げてください" : "🤖 聞き手から"}</span>
          <p>{aiQuestion}</p>
        </div>
      )}

      <MicInput
        paused={!active}
        maxLength={3000}
        value={text}
        onChange={setText}
        micLabel={turns.length ? "答える" : "話す"}
        rows={4}
        placeholder={turns.length ? "話した内容がここに入ります" : "例: PF管はな、90度の曲がりが3つあったら線が通らん。プルボックスを入れる。"}
      />
      {err && <p className="hint error">{err}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !text.trim()} onClick={() => next(false)}>
          {busy ? "考えています…" : turns.length ? "次へ" : "話した内容を送る"}
        </button>
        {turns.length > 0 && (
          <button className="secondary" disabled={busy} onClick={() => next(true)}>
            カードにする
          </button>
        )}
      </div>

      <ul className="promise">
        <li>声は残しません。文字だけを使います</li>
        <li>方言・話し言葉のままで大丈夫です</li>
        <li>あなたが確かめるまで、公開しません</li>
        <li>名前を出すかどうか、毎回選べます</li>
      </ul>
    </section>
  );
}
