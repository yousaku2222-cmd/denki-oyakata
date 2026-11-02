import { useState } from "react";
import { call } from "../firebase";
import { deviceId, getName, setName } from "../local";
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

export function Talk({ topic, onDone }: { topic: Topic | null; onDone: () => void }) {
  const [listenerMode, setListenerMode] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cardId, setCardId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [showName, setShowName] = useState(true);
  const [name, setNameState] = useState(getName("veteran"));
  const [published, setPublished] = useState(false);

  async function next(finish = false) {
    const t: Turn[] = text.trim()
      ? [...turns, ...(aiQuestion ? [{ role: "ai" as const, text: aiQuestion }] : []), { role: "veteran", text: text.trim() }]
      : turns;
    if (!t.some((x) => x.role === "veteran")) return;
    setBusy(true);
    setErr("");
    try {
      setTurns(t);
      setText("");
      setAiQuestion("");
      const r = finish
        ? { done: true, question: "" }
        : await call<{ done: boolean; question: string }>("interviewNext", { transcript: t, questionText: topic?.text });
      if (!r.done) {
        setAiQuestion(r.question);
      } else {
        const d = await call<{ cardId: string; draft: Draft }>("draftCard", {
          transcript: t,
          authorId: deviceId(),
          authorName: name,
          triggerQuestionId: topic?.questionId,
        });
        setCardId(d.cardId);
        setDraft(d.draft);
        setTagsText(d.draft.tags.join("、"));
      }
    } catch {
      setErr("うまく送れませんでした。もう一度お試しください。");
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
      await call("publishCard", {
        cardId,
        authorId: deviceId(),
        authorName: name,
        showAuthorName: showName,
        edits: { ...draft, tags: tagsText.split(/[、,\s]+/).filter(Boolean) },
      });
      setPublished(true);
    } catch {
      setErr("公開できませんでした。題名とやり方が入っているか確かめてください。");
    } finally {
      setBusy(false);
    }
  }

  if (published) {
    return (
      <section className="screen center">
        <div className="big-emoji">🗂️</div>
        <h1 className="screen-title">知恵袋に入りました</h1>
        <p>若手が聞けば、あなたの話が答えに出てきます。{topic && `${topic.askerName}さんにも届きます。`}</p>
        <button className="primary" onClick={onDone}>
          続けて話す
        </button>
      </section>
    );
  }

  if (draft) {
    const field = (key: keyof Draft, label: string, rows = 2) => (
      <label className="field">
        <span>{label}</span>
        <textarea rows={rows} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      </label>
    );
    return (
      <section className="screen">
        <h1 className="screen-title">知恵カードの下書き</h1>
        <p className="hint">中身を確かめてください。直してから公開できます。公開するまで、誰にも見えません。</p>
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
          {showName && <input placeholder="例: 溝上（親方）" value={name} onChange={(e) => setNameState(e.target.value)} />}
          <label className="radio">
            <input type="radio" checked={!showName} onChange={() => setShowName(false)} /> 出さない（「社内のベテラン」と表示）
          </label>
        </fieldset>
        {err && <p className="hint error">{err}</p>}
        <button className="primary" disabled={busy || !draft.title.trim() || !draft.body.trim()} onClick={publish}>
          {busy ? "公開しています…" : "確かめたので公開する"}
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
