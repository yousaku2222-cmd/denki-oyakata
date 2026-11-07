import { useEffect, useState } from "react";
import { getRole, getTheme, getTrial, setRole as saveRole, setTheme as saveTheme, setTrial, type Role } from "./local";
import { Ask } from "./screens/Ask";
import { SENT_TO_BOX } from "./FlyToMe";
import { Talk, type Topic } from "./screens/Talk";
import { Box, lastSeen as boxLastSeen } from "./screens/Box";
import { MyCards, markHelpedSeen, newlyHelped } from "./screens/MyCards";
import { Me, lastSeen as meLastSeen } from "./screens/Me";
import { Browse } from "./screens/Browse";
import { Calc } from "./screens/Calc";
import { Photo, type CalcStart } from "./screens/Photo";
import { FlowSteps } from "./FlowSteps";
import { Icon } from "./Icon";
import { UpdateNote } from "./UpdateNote";
import { call } from "./firebase";

type Tab = "ask" | "browse" | "calc" | "photo" | "me" | "talk" | "box" | "mycards";

// the tabs keep the emoji (the author's choice): the drawn icons are for the screens themselves
const TABS: Record<Role, { id: Tab; icon: string; label: string }[]> = {
  young: [
    { id: "ask", icon: "🎤", label: "聞く" },
    { id: "browse", icon: "🔎", label: "探す" },
    // 計算 opens from 撮る's 🧮 (and Claude uses it on 聞く): no tab of its own
    { id: "photo", icon: "📷", label: "撮る" },
    { id: "me", icon: "🙂", label: "わたし" },
  ],
  veteran: [
    { id: "talk", icon: "🎙️", label: "話す" },
    { id: "box", icon: "📮", label: "質問箱" },
    { id: "mycards", icon: "🗂️", label: "わたしの\nカード" },
  ],
};

export default function App() {
  // every start is at the choice of role (a shared phone, or a veteran handing it to a young worker); the last one
  // is marked there so it is one press away
  const [role, setRoleState] = useState<Role | null>(null);
  const [tab, setTab] = useState<Tab>(role === "veteran" ? "talk" : "ask");
  // a question sent to the 質問箱 lands on わたし (where the answer will come back): a dot until it is opened
  const [meDot, setMeDot] = useState(false);
  // わたし →「答えを聞く」: the question is asked again on 聞く (now the veteran's card is there to answer it)
  const [askSeed, setAskSeed] = useState<{ text: string; questionId: string; n: number } | null>(null);
  // another tab opens at its top, not at the place the last one was scrolled to
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
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
  const [boxQs, setBoxQs] = useState<OpenQ[]>([]); // all the open ones, for 話す's way to the box
  const boxOpen = boxQs.length;
  useEffect(() => {
    if (role !== "veteran" || tab === "box") return;
    call<{ questions: OpenQ[] }>("openQuestions", {})
      .then((r) => {
        setBoxNew(r.questions.filter((q) => q.lastAskedAt > boxLastSeen()).length);
        setBoxQs(r.questions);
      })
      .catch(() => {}); // only a hint
  }, [role, tab]);
  // a veteran's card that helped someone since わたしのカード was last opened: dot on that tab when the app opens
  const [cardsDot, setCardsDot] = useState(false);
  // ...and the same news on top of 話す, the screen a veteran opens first: whose story helped, and how many more times
  type MyCard = { id: string; title: string; helpedCount: number; status: string };
  const [thanks, setThanks] = useState<{ cards: MyCard[]; news: { title: string; total: number; n: number }[] } | null>(null);
  useEffect(() => {
    if (role !== "veteran") return;
    call<{ cards: MyCard[] }>("myCards", {})
      .then((r) => {
        const news = newlyHelped(r.cards).map(({ id, n }) => {
          const c = r.cards.find((x) => x.id === id)!;
          return { title: c.title, total: c.helpedCount, n };
        });
        if (!news.length) return;
        setCardsDot(true);
        setThanks({ cards: r.cards, news });
      })
      .catch(() => {}); // only a hint
  }, [role]);
  const thanksSeen = () => {
    if (thanks) markHelpedSeen(thanks.cards);
    setThanks(null);
    setCardsDot(false);
  };
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

  if (!role) return <Entry onChoose={choose} last={getRole()} />;

  const startTalk = (t: Topic | null, resume: string | null = null, force = false) => {
    // starting another story replaces the one on 話す: do not drop what was told without asking
    if (!force && talkDirty && !confirm("「話す」で話している途中の内容は消えます。よろしいですか？")) return;
    setTalkDirty(false);
    setTopic(t);
    setResumeId(resume);
    setTalkKey((k) => k + 1);
    setTab("talk");
    window.scrollTo(0, 0); // the question being answered is at the top of 話す
  };

  return (
    <div className="app" data-role={role}>
      <PcNote />
      {getTrial() && <TrialGuide role={role} />}
      <div className="top-wrap">
      <header className="top">
        <span className="logo">⚡ でんきの親方</span>
        <span className="role-badge" role="img" aria-label={role === "veteran" ? "ベテラン" : "若手"}>
          {role === "veteran" ? "🧰" : "🔰"}
          <span className="badge-word">{role === "veteran" ? "ベテラン" : "若手"}</span>
        </span>
        <button className="icon-btn" aria-label="明るさの切り替え" onClick={toggleTheme}>
          ◐
        </button>
        <button className="icon-btn" onClick={() => (role !== "veteran" || !talkDirty || confirm("「話す」で話している途中の内容は消えます。切り替えますか？")) && choose(null)}>
          切替
        </button>
      </header>
      <UpdateNote dirty={role === "veteran" && talkDirty} />
      {getTrial() && (
        // one line: the rest of the screen is the demo. The next step is the other role (見本の話 is on the veteran's side)
        <p className="trial-note" title="公開したカードと送った質問は、この端末にだけ見えます">
          <span>🧪 審査員モード（作った物はこの端末だけ）</span>
          {role === "young" ? (
            <button className="trial-end trial-next" onClick={() => choose("veteran")}>
              🧰 ベテランで試す
            </button>
          ) : (
            <button className="trial-end trial-next" onClick={() => (!talkDirty || confirm("「話す」で話している途中の内容は消えます。切り替えますか？")) && choose("young")}>
              🔰 若手で聞く
            </button>
          )}
          <button className="trial-end" onClick={() => (role !== "veteran" || !talkDirty || confirm("「話す」で話している途中の内容は消えます。審査員モードを終えますか？")) && choose(null, false)}>
            終える
          </button>
        </p>
      )}
      </div>

      <main>
        {getTrial() && <TrialSteps role={role} />}
        {tab === "ask" && (role === "veteran" ? <VeteranAsk role={role} /> : <Ask key={askSeed?.n ?? 0} role={role} seed={askSeed?.text} seedQuestionId={askSeed?.questionId} />)}
        {tab === "browse" && <Browse />}
        {tab === "calc" && (
          <>
            {/* no tab of its own: the way back to 撮る, where it was opened from */}
            <button className="link back-link calc-back" onClick={() => setTab("photo")}>
              ← 撮るに戻る
            </button>
            <Calc key={calcStart ? JSON.stringify(calcStart) : "list"} start={calcStart} />
          </>
        )}
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
            onAsk={(text) => {
              setAskSeed({ text, questionId: "", n: Date.now() });
              setTab("ask");
            }}
          />
        )}
        {/* kept mounted while other tabs are open, so a half-told story is not lost */}
        {role === "veteran" && (
          <div hidden={tab !== "talk"}>
            {/* not for a judge: it loads a moment after 話す opens and would push the sample button down */}
            {thanks && !talkDirty && !getTrial() && (
              <div className="thanks-note" role="status">
                <strong>🙏 あなたの話が、若手の役に立ちました</strong>
                <ul>
                  {thanks.news.slice(0, 3).map((x) => (
                    <li key={x.title}>
                      「{x.title}」　助かった {x.total}件<span className="thanks-plus">（前に見てから +{x.n}）</span>
                    </li>
                  ))}
                </ul>
                {thanks.news.length > 3 && <p className="hint">ほかに {thanks.news.length - 3}枚</p>}
                <div className="thanks-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setThanks(null); // わたしのカード counts them up and saves them as seen
                      setTab("mycards");
                    }}
                  >
                    わたしのカードを見る
                  </button>
                  <button className="link" onClick={thanksSeen}>
                    閉じる
                  </button>
                </div>
              </div>
            )}
            <Talk key={talkKey} topic={topic} resumeCardId={resumeId} active={tab === "talk"} onDirty={setTalkDirty} onDone={() => startTalk(null, null, true)} boxOpen={boxOpen} onOpenBox={() => setTab("box")}
              lead={!talkDirty && <Waiting questions={boxQs} onAnswer={(q) => startTalk(q)} onOpenBox={() => setTab("box")} />}
              onTryAsYoung={(q) => {
                choose("young");
                setAskSeed({ text: q, questionId: "", n: Date.now() });
                window.scrollTo(0, 0);
              }}
              onBack={() => {
                startTalk(null, null, true);
                setTab("mycards");
              }}
            />
          </div>
        )}
        {tab === "box" && <Box onAnswer={startTalk} />}
        {tab === "mycards" && <MyCards onEdit={(id) => startTalk(null, id)} onOpenBox={() => setTab("box")} />}
        <p className="disclaimer">最終判断は、有資格者・責任者が行ってください。</p>
      </main>

      <nav className="tabs">
        {TABS[role].map((t) => {
          const on = tab === t.id || (tab === "calc" && t.id === "photo"); // 計算 is opened from 撮る: 撮る stays lit
          return (
          <button
            key={t.id}
            data-tab={t.id}
            className={on ? "on" : ""}
            aria-current={on ? "page" : undefined}
            onClick={() => {
              if (t.id === "me") setMeDot(false);
              if (t.id === "mycards") {
                setCardsDot(false);
                setThanks(null);
              }
              if (t.id === "box") setBoxNew(0);
              setAskSeed(null); // a tab press opens 聞く empty, not with the last question
              setTab(t.id); // 話す keeps what was being told; 「続けて話す」 starts a new one
            }}
          >
            <span className="tab-icon">
              <Icon of={t.icon} />
              {((t.id === "me" && meDot) || (t.id === "mycards" && cardsDot)) && <span className="tab-dot" role="img" aria-label="新しい知らせ" />}
              {t.id === "box" && boxNew > 0 && (
                <span className="tab-count" role="img" aria-label={`新着${boxNew}件`}>
                  {boxNew > 9 ? "9+" : boxNew}
                </span>
              )}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
          );
        })}
      </nav>
    </div>
  );
}

// 調べる (聞く, 探す and 計算 in one) is off the veterans' tabs, so 話す comes first; kept to put back if asked for.
function VeteranAsk({ role }: { role: Role }) {
  const [view, setView] = useState<"ask" | "browse" | "calc">("ask");
  return (
    <>
      <div className="segmented">
        <button className={view === "ask" ? "on" : ""} aria-pressed={view === "ask"} onClick={() => setView("ask")}>
          聞く
        </button>
        <button className={view === "browse" ? "on" : ""} aria-pressed={view === "browse"} onClick={() => setView("browse")}>
          探す
        </button>
        <button className={view === "calc" ? "on" : ""} aria-pressed={view === "calc"} onClick={() => setView("calc")}>
          計算
        </button>
      </div>
      {view === "ask" ? <Ask role={role} /> : view === "browse" ? <Browse /> : <Calc start={null} />}
    </>
  );
}


/**
 * 審査員モード, on a wide screen only: what to try in 3 minutes, on the empty left side. The steps done in the
 * role now shown are marked.
 */
// the veteran's side first: what is told there is what the young worker hears back next
const TRIAL_STEPS: { on: Role; text: string; short: string }[] = [
  { on: "veteran", text: "ベテランで「🧪 見本の話で試す」→ 話を送って、カードにする", short: "ベテランで「🧪 見本の話」→ カードにする" },
  { on: "young", text: "「🔰 若手として聞いてみる」で聞くと、さっき話した言葉が緑の札で出る（約30秒かかります）", short: "若手で聞くと、話した言葉が緑の札で出る（約30秒）" },
  { on: "young", text: "「よく聞かれる質問」を押すと、保存した答えが一瞬で出る（根拠と「✔ 原文と一致」を見る。さっきの話に近い質問だけは、あなたのカードを入れて作るので初回は約20秒）", short: "「よく聞かれる質問」は一瞬で出る（話に近い質問は初回だけ約20秒）" },
];

/** 審査員モード on a phone (the PC has TrialGuide beside the app): the 3 steps, the ones of this role in bold. */
function TrialSteps({ role }: { role: Role }) {
  return (
    <ol className="trial-steps">
      {TRIAL_STEPS.map((s, i) => (
        <li key={i} className={role === s.on ? "now" : ""}>
          {s.short}
        </li>
      ))}
    </ol>
  );
}

function TrialGuide({ role }: { role: Role | null }) {
  return (
    <aside className="trial-guide">
      <strong>🧪 審査員向け 3分の試し方</strong>
      <ol>
        {TRIAL_STEPS.map((s, i) => (
          <li key={i} className={role === s.on ? "now" : ""}>
            {s.text}
          </li>
        ))}
      </ol>
    </aside>
  );
}

// a question in 質問箱, as openQuestions gives it (the fields 話す's top needs)
type OpenQ = { id: string; text: string; askerName: string; hasPhoto: boolean; followUp: Topic["followUp"]; createdAt: number; lastAskedAt: number };

/**
 * On top of 話す: the young worker who has waited longest, by name, one press from answering. A veteran opens 話す
 * first, and a question with a person behind it is a reason to talk that a list of counts is not.
 */
function Waiting({ questions, onAnswer, onOpenBox }: { questions: OpenQ[]; onAnswer: (t: Topic) => void; onOpenBox: () => void }) {
  if (!questions.length) return null;
  const q = questions.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
  const days = Math.floor((Date.now() - q.createdAt) / 86400000);
  const rest = questions.length - 1;
  return (
    <div className="waiting-q">
      <p className="waiting-head">
        📮 {q.askerName || "若手"}さんが聞いています<span className="waiting-days">（{days > 0 ? `${days}日前` : "今日"}）</span>
      </p>
      <p className="waiting-text">{q.text}</p>
      <button className="primary" onClick={() => onAnswer({ questionId: q.id, text: q.text, askerName: q.askerName, hasPhoto: q.hasPhoto, followUp: q.followUp })}>
        ✍️ 答える（話す・書く）
      </button>
      {rest > 0 && (
        <button className="link" onClick={onOpenBox}>
          ほかに{rest}件 →（質問箱へ）
        </button>
      )}
    </div>
  );
}

/** Beside the app on a wide screen only: the mic and camera are for phones. */
function PcNote() {
  return (
    <aside className="pc-note">
      <strong>📱 スマホでも開けます</strong>
      話す（マイク）と撮る（カメラ）は、スマホで開くとそのまま使えます。
      <br />
      denki-oyakata.web.app
    </aside>
  );
}

function Entry({ onChoose, last }: { onChoose: (r: Role, trial?: boolean) => void; last: Role | null }) {
  return (
    <div className="entry">
      <PcNote />
      <TrialGuide role={null} />
      <UpdateNote />
      <div className="entry-logo">⚡</div>
      <h1>でんきの親方</h1>
      <p className="catch">
        <span>あなたの一言が、</span>
        <span>業界の未来へつながる</span>
      </p>
      {/* what it solves, under the catch (the catch alone does not say) */}
      <p className="catch-sub">ベテランは話すだけで現場の知恵を残し、若手は法令と知恵を根拠つきで聞けます</p>
      <FlowSteps
        label="しくみ"
        steps={[
          { icon: "/flow/talk.webp", label: "親方が話す" },
          { icon: "/flow/card.webp", label: "カードになる" },
          { icon: "/flow/answer.webp", label: "若手に届く" },
        ]}
      />
      <button className="role-btn" onClick={() => onChoose("veteran")}>
        {last === "veteran" && <span className="last-chip">前回</span>}
        ベテランとして使う
        <small>話すだけで、知恵がカードになります</small>
      </button>
      <button className="role-btn young" onClick={() => onChoose("young")}>
        {last === "young" && <span className="last-chip">前回</span>}
        若手として使う
        <small>現場の疑問に、根拠つきで答えます</small>
      </button>
      {getTrial() ? (
        <p className="trial-note entry-trial">🧪 審査員モード中です。① ベテランで見本の話をカードにする ② 若手で聞くと、その言葉が緑の札で出る（約30秒） ③「よく聞かれる質問」は一瞬で出ます（さっきの話に近い質問は、初回だけ約20秒）。</p>
      ) : (
        // as strong as the two roles: the judges are the first ones to open this. It starts on the veteran's side
        // (the sample story), so the card it makes is in the young worker's answer after
        <button className="role-btn judge" onClick={() => onChoose("veteran", true)}>
          🧪 審査員の方はこちら
          <small>見本の話でカードを作り、若手で確かめられます</small>
        </button>
      )}
      <p className="entry-ai">AI は Claude：質問の仕分けに Haiku、答え・聞き取り・写真に Sonnet、条文の整理と点検に Opus</p>
    </div>
  );
}
