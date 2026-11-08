import { useState, type ReactNode } from "react";
import { PLACES, WORKS, openersFor, questionsFor, type Place, type Work } from "./sceneQuestions";

/**
 * 🧭 Where and what: two rows of chips, and what they give. A young worker gets questions (put in the box to add
 * their own situation); a veteran gets openers for the listener. Nothing picked: `idle` is shown (話す's starters).
 */
export function SceneFinder({ who, onPick, idle }: { who: "young" | "veteran"; onPick: (q: string) => void; idle?: ReactNode }) {
  const [place, setPlace] = useState<Place | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const list = who === "young" ? questionsFor(place, work) : openersFor(place, work);
  const row = <K extends string>(items: readonly { key: K; label: string }[], on: K | null, set: (k: K | null) => void) => (
    <div className="scene-chips">
      {items.map((x) => (
        <button key={x.key} type="button" className={`scene-chip ${on === x.key ? "on" : ""}`} aria-pressed={on === x.key} onClick={() => set(on === x.key ? null : x.key)}>
          {x.label}
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
      {list.length > 0 ? (
        <div className="scene-list">
          <p className="hint">{who === "young" ? "こんな疑問はありませんか？（押すと入力欄に入ります。自分の状況を書き足して聞けます）" : "押すと、聞き手がその質問から始めます"}</p>
          {list.map((q) => (
            <button key={q} type="button" className="seed" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : (
        idle
      )}
    </div>
  );
}
