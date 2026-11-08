import { useState, type ReactNode } from "react";
import { PLACES, WORKS, inScene, openersFor, questionsFor, sceneOf, type Place, type Work } from "./sceneQuestions";

/** A young worker's question waiting for a veteran (質問箱, or one only the AI answered: no id). */
export interface YoungAsk {
  text: string;
  open: () => void; // starts 話す on it, as 質問箱 does
}

/**
 * 🧭 Where and what: two rows of chips, and what they give. A young worker gets questions (put in the box to add
 * their own situation); a veteran gets openers for the listener. Nothing picked: `idle` is shown (話す's starters).
 */
export function SceneFinder({ who, onPick, idle, asks = [] }: { who: "young" | "veteran"; onPick: (q: string) => void; idle?: ReactNode; asks?: YoungAsk[] }) {
  const [place, setPlace] = useState<Place | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const list = who === "young" ? questionsFor(place, work) : openersFor(place, work);
  // a veteran sees where the young are asking: 📮 on those chips, and their questions first
  const scenes = asks.map((a) => sceneOf(a.text));
  const count = (k: string) => scenes.filter((s) => (s.places as string[]).includes(k) || (s.works as string[]).includes(k)).length;
  const waiting = asks.filter((a) => inScene(a.text, place, work)).slice(0, 3);
  const row = <K extends string>(items: readonly { key: K; label: string }[], on: K | null, set: (k: K | null) => void) => (
    <div className="scene-chips">
      {items.map((x) => (
        <button key={x.key} type="button" className={`scene-chip ${on === x.key ? "on" : ""}`} aria-pressed={on === x.key} onClick={() => set(on === x.key ? null : x.key)}>
          {x.label}
          {count(x.key) > 0 && <span className="scene-asked">📮{count(x.key)}</span>}
        </button>
      ))}
    </div>
  );
  return (
    <div className="scene-finder">
      <p className="scene-head">{who === "young" ? "🧭 何を聞けばいいか分からない時は、選んでみてください" : "🧭 場面を選ぶと、話のきっかけが出ます"}</p>
      <p className="scene-k">{who === "young" ? "今どこ？" : "どこの話？"}</p>
      {row(PLACES, place, setPlace)}
      <p className="scene-k">何の作業？</p>
      {row(WORKS, work, setWork)}
      {asks.length > 0 && !place && !work && <p className="hint scene-asked-note">📮 の数は、若手から来ている質問の数です</p>}
      {waiting.length > 0 && (
        <div className="scene-list">
          <p className="hint">📮 若手から来ている質問（押すと、この質問に答えられます）</p>
          {waiting.map((a) => (
            <button key={a.text} type="button" className="seed young-q" onClick={a.open}>
              {a.text}
            </button>
          ))}
        </div>
      )}
      {list.length > 0 ? (
        <div className="scene-list">
          <p className="hint">{who === "young" ? "こんな疑問はありませんか？（押すと入力欄に入ります。自分の状況を書き足して聞けます）" : "押すと、聞き手がその質問から始めます"}</p>
          {list.map((q) => (
            <button key={q} type="button" className="seed" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : place && work && who === "young" ? (
        <p className="hint">この組み合わせの候補はまだありません。場所か作業の片方だけ選ぶと出ます。</p>
      ) : (
        idle
      )}
    </div>
  );
}
