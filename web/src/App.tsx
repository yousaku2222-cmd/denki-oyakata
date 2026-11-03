import { useEffect, useState } from "react";
import { getRole, getTheme, setRole as saveRole, setTheme as saveTheme, type Role } from "./local";
import { Ask } from "./screens/Ask";
import { Talk, type Topic } from "./screens/Talk";
import { Box } from "./screens/Box";
import { MyCards } from "./screens/MyCards";
import { Me } from "./screens/Me";
import { Browse } from "./screens/Browse";
import { Calc } from "./screens/Calc";
import { Photo, type CalcStart } from "./screens/Photo";

type Tab = "ask" | "browse" | "calc" | "photo" | "me" | "talk" | "box" | "mycards";

const TABS: Record<Role, { id: Tab; icon: string; label: string }[]> = {
  young: [
    { id: "ask", icon: "🎤", label: "聞く" },
    { id: "browse", icon: "🔎", label: "探す" },
    { id: "calc", icon: "🧮", label: "計算" },
    { id: "photo", icon: "📷", label: "撮る" },
    { id: "me", icon: "🙂", label: "わたし" },
  ],
  veteran: [
    { id: "talk", icon: "🎙️", label: "話す" },
    { id: "box", icon: "📮", label: "質問箱" },
    { id: "ask", icon: "🔎", label: "聞く・探す" },
    { id: "mycards", icon: "🗂️", label: "わたしの\nカード" },
  ],
};

export default function App() {
  const [role, setRoleState] = useState<Role | null>(getRole());
  const [tab, setTab] = useState<Tab>(role === "veteran" ? "talk" : "ask");
  const [topic, setTopic] = useState<Topic | null>(null);
  const [talkKey, setTalkKey] = useState(0);
  const [theme, setThemeState] = useState(getTheme());
  const [calcStart, setCalcStart] = useState<CalcStart | null>(null);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  function choose(r: Role | null) {
    saveRole(r);
    setRoleState(r);
    setTab(r === "veteran" ? "talk" : "ask");
  }

  function toggleTheme() {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    saveTheme(next);
    setThemeState(next);
  }

  if (!role) return <Entry onChoose={choose} />;

  const startTalk = (t: Topic | null) => {
    setTopic(t);
    setTalkKey((k) => k + 1);
    setTab("talk");
  };

  return (
    <div className="app">
      <header className="top">
        <span className="logo">⚡ でんきの親方</span>
        <span className="role-badge">{role === "veteran" ? "ベテラン" : "若手"}</span>
        <button className="icon-btn" aria-label="明るさの切り替え" onClick={toggleTheme}>
          ◐
        </button>
        <button className="icon-btn" onClick={() => choose(null)}>
          切替
        </button>
      </header>

      <main>
        {tab === "ask" && (role === "veteran" ? <VeteranAsk role={role} /> : <Ask role={role} />)}
        {tab === "browse" && <Browse />}
        {tab === "calc" && <Calc key={calcStart ? JSON.stringify(calcStart) : "list"} start={calcStart} />}
        {tab === "photo" && (
          <Photo
            onCalc={(s) => {
              setCalcStart(s);
              setTab("calc");
            }}
          />
        )}
        {tab === "me" && <Me />}
        {tab === "talk" && <Talk key={talkKey} topic={topic} onDone={() => startTalk(null)} />}
        {tab === "box" && <Box onAnswer={startTalk} />}
        {tab === "mycards" && <MyCards />}
        <p className="disclaimer">最終判断は、有資格者・責任者が行ってください。</p>
      </main>

      <nav className="tabs">
        {TABS[role].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => {
              if (t.id === "calc") setCalcStart(null);
              if (t.id === "talk" && tab !== "talk") startTalk(null);
              else setTab(t.id);
            }}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function VeteranAsk({ role }: { role: Role }) {
  const [view, setView] = useState<"ask" | "browse">("ask");
  return (
    <>
      <div className="segmented">
        <button className={view === "ask" ? "on" : ""} onClick={() => setView("ask")}>
          聞く
        </button>
        <button className={view === "browse" ? "on" : ""} onClick={() => setView("browse")}>
          探す
        </button>
      </div>
      {view === "ask" ? <Ask role={role} /> : <Browse />}
    </>
  );
}


function Entry({ onChoose }: { onChoose: (r: Role) => void }) {
  return (
    <div className="entry">
      <div className="entry-logo">⚡</div>
      <h1>でんきの親方</h1>
      <p className="catch">あなたの一言が、業界の未来へつながる</p>
      <ol className="steps">
        <li>
          <span>🎙️</span>ベテランが話す
        </li>
        <li>
          <span>🗂️</span>知恵カードになる
        </li>
        <li>
          <span>🙋</span>若手が聞ける
        </li>
      </ol>
      <button className="role-btn" onClick={() => onChoose("veteran")}>
        ベテランとして使う
        <small>話すだけで、知恵がカードになります</small>
      </button>
      <button className="role-btn young" onClick={() => onChoose("young")}>
        若手として使う
        <small>現場の疑問に、根拠つきで答えます</small>
      </button>
      <button className="link" onClick={() => onChoose("young")}>
        審査員の方はこちら（デモ）
      </button>
    </div>
  );
}
