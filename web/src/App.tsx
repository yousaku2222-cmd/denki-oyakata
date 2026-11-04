import { useEffect, useState } from "react";
import { getRole, getTheme, getTrial, setRole as saveRole, setTheme as saveTheme, setTrial, type Role } from "./local";
import { Ask } from "./screens/Ask";
import { SENT_TO_BOX } from "./FlyToMe";
import { Talk, type Topic } from "./screens/Talk";
import { Box, lastSeen as boxLastSeen } from "./screens/Box";
import { MyCards, newlyHelped } from "./screens/MyCards";
import { Me, lastSeen as meLastSeen } from "./screens/Me";
import { Browse } from "./screens/Browse";
import { Calc } from "./screens/Calc";
import { Photo, type CalcStart } from "./screens/Photo";
import { FlowSteps } from "./FlowSteps";
import { call } from "./firebase";

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
    { id: "ask", icon: "🔎", label: "調べる" },
    { id: "mycards", icon: "🗂️", label: "わたしの\nカード" },
  ],
};

export default function App() {
  const [role, setRoleState] = useState<Role | null>(getRole());
  const [tab, setTab] = useState<Tab>(role === "veteran" ? "talk" : "ask");
  // a question sent to the 質問箱 lands on わたし (where the answer will come back): a dot until it is opened
  const [meDot, setMeDot] = useState(false);
  // わたし →「答えを聞く」: the question is asked again on 聞く (now the veteran's card is there to answer it)
  const [askSeed, setAskSeed] = useState<{ text: string; questionId: string; n: number } | null>(null);
  // an answer that came back since わたし was last opened: dot on わたし when the app opens
  useEffect(() => {
    if (role !== "young") return;
    call<{ questions: { answeredAt: number }[] }>("myQuestions", {})
      .then((r) => r.questions.some((q) => q.answeredAt > meLastSeen()) && setMeDot(true))
      .catch(() => {}); // only a hint: without it, わたし still shows the news when opened
  }, [role]);
  // 質問箱: how many came in (or were joined) since it was last opened, counted when the app opens and on each
  // tab change; opening it clears the number
  const [boxNew, setBoxNew] = useState(0);
  const [boxOpen, setBoxOpen] = useState(0); // all the open ones, for 話す's way to the box
  useEffect(() => {
    if (role !== "veteran" || tab === "box") return;
    call<{ questions: { lastAskedAt: number }[] }>("openQuestions", {})
      .then((r) => {
        setBoxNew(r.questions.filter((q) => q.lastAskedAt > boxLastSeen()).length);
        setBoxOpen(r.questions.length);
      })
      .catch(() => {}); // only a hint
  }, [role, tab]);
  // a veteran's card that helped someone since わたしのカード was last opened: dot on that tab when the app opens
  const [cardsDot, setCardsDot] = useState(false);
  useEffect(() => {
    if (role !== "veteran") return;
    call<{ cards: { id: string; helpedCount: number; status: string }[] }>("myCards", {})
      .then((r) => newlyHelped(r.cards).length > 0 && setCardsDot(true))
      .catch(() => {}); // only a hint
  }, [role]);
  useEffect(() => {
    const on = () => setMeDot(true);
    window.addEventListener(SENT_TO_BOX, on);
    return () => window.removeEventListener(SENT_TO_BOX, on);
  }, []);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [talkKey, setTalkKey] = useState(0);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [talkDirty, setTalkDirty] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const [calcStart, setCalcStart] = useState<CalcStart | null>(null);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Switching role keeps 審査員モード; it ends only with 「終える」.
  function choose(r: Role | null, trial?: boolean) {
    if (trial !== undefined) setTrial(trial);
    setTalkDirty(false); // 話す goes away with the role; nothing is left in progress
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

  const startTalk = (t: Topic | null, resume: string | null = null, force = false) => {
    // starting another story replaces the one on 話す: do not drop what was told without asking
    if (!force && talkDirty && !confirm("「話す」で話している途中の内容は消えます。よろしいですか？")) return;
    setTalkDirty(false);
    setTopic(t);
    setResumeId(resume);
    setTalkKey((k) => k + 1);
    setTab("talk");
  };

  return (
    <div className="app" data-role={role}>
      <div className="top-wrap">
      <header className="top">
        <span className="logo">⚡ でんきの親方</span>
        <span className="role-badge">{role === "veteran" ? "🧰ベテラン" : "🔰若手"}</span>
        <button className="icon-btn" aria-label="明るさの切り替え" onClick={toggleTheme}>
          ◐
        </button>
        <button className="icon-btn" onClick={() => (role !== "veteran" || !talkDirty || confirm("「話す」で話している途中の内容は消えます。切り替えますか？")) && choose(null)}>
          切替
        </button>
      </header>
      {getTrial() && (
        <p className="trial-note">
          🧪 審査員モード：公開したカードと送った質問は、この端末にだけ見えます
          <button className="link" onClick={() => choose(null, false)}>
            終える
          </button>
        </p>
      )}
      </div>

      <main>
        {tab === "ask" && (role === "veteran" ? <VeteranAsk role={role} /> : <Ask key={askSeed?.n ?? 0} role={role} seed={askSeed?.text} seedQuestionId={askSeed?.questionId} />)}
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
        {tab === "me" && (
          <Me
            onAskAgain={(text, questionId) => {
              setAskSeed({ text, questionId, n: Date.now() });
              setTab("ask");
            }}
          />
        )}
        {/* kept mounted while other tabs are open, so a half-told story is not lost */}
        {role === "veteran" && (
          <div hidden={tab !== "talk"}>
            <Talk key={talkKey} topic={topic} resumeCardId={resumeId} active={tab === "talk"} onDirty={setTalkDirty} onDone={() => startTalk(null, null, true)} boxOpen={boxOpen} onOpenBox={() => setTab("box")}
              onBack={() => {
                startTalk(null, null, true);
                setTab("mycards");
              }}
            />
          </div>
        )}
        {tab === "box" && <Box onAnswer={startTalk} />}
        {tab === "mycards" && <MyCards onEdit={(id) => startTalk(null, id)} />}
        <p className="disclaimer">最終判断は、有資格者・責任者が行ってください。</p>
      </main>

      <nav className="tabs">
        {TABS[role].map((t) => (
          <button
            key={t.id}
            data-tab={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => {
              if (t.id === "calc") setCalcStart(null);
              if (t.id === "me") setMeDot(false);
              if (t.id === "mycards") setCardsDot(false);
              if (t.id === "box") setBoxNew(0);
              setAskSeed(null); // a tab press opens 聞く empty, not with the last question
              setTab(t.id); // 話す keeps what was being told; 「続けて話す」 starts a new one
            }}
          >
            <span className="tab-icon">
              {t.icon}
              {((t.id === "me" && meDot) || (t.id === "mycards" && cardsDot)) && <span className="tab-dot" aria-label="新しい知らせ" />}
              {t.id === "box" && boxNew > 0 && (
                <span className="tab-count" aria-label={`新着${boxNew}件`}>
                  {boxNew > 9 ? "9+" : boxNew}
                </span>
              )}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// Veterans keep four big tabs: 聞く, 探す and 計算 share one (they use calculations for estimates and checks too).
function VeteranAsk({ role }: { role: Role }) {
  const [view, setView] = useState<"ask" | "browse" | "calc">("ask");
  return (
    <>
      <div className="segmented">
        <button className={view === "ask" ? "on" : ""} onClick={() => setView("ask")}>
          聞く
        </button>
        <button className={view === "browse" ? "on" : ""} onClick={() => setView("browse")}>
          探す
        </button>
        <button className={view === "calc" ? "on" : ""} onClick={() => setView("calc")}>
          計算
        </button>
      </div>
      {view === "ask" ? <Ask role={role} /> : view === "browse" ? <Browse /> : <Calc start={null} />}
    </>
  );
}


function Entry({ onChoose }: { onChoose: (r: Role, trial?: boolean) => void }) {
  return (
    <div className="entry">
      <div className="entry-logo">⚡</div>
      <h1>でんきの親方</h1>
      <p className="catch">
        <span>あなたの一言が、</span>
        <span>業界の未来へつながる</span>
      </p>
      <FlowSteps
        label="しくみ"
        steps={[
          { icon: "/flow/talk.webp", label: "親方が話す" },
          { icon: "/flow/card.webp", label: "カードになる" },
          { icon: "/flow/answer.webp", label: "若手に届く" },
        ]}
      />
      <button className="role-btn" onClick={() => onChoose("veteran")}>
        ベテランとして使う
        <small>話すだけで、知恵がカードになります</small>
      </button>
      <button className="role-btn young" onClick={() => onChoose("young")}>
        若手として使う
        <small>現場の疑問に、根拠つきで答えます</small>
      </button>
      {getTrial() ? (
        <p className="trial-note entry-trial">🧪 審査員モード中です。役割を選ぶと、そのまま続きます。</p>
      ) : (
        <button className="link" onClick={() => onChoose("young", true)}>
          審査員の方はこちら（デモ）
        </button>
      )}
    </div>
  );
}
