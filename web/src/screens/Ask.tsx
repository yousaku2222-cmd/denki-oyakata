import { useState } from "react";
import { call } from "../firebase";
import { getName, type Role } from "../local";
import { MicInput, Notice, SOURCE_LABEL, fmtDate, type Sentence } from "../components";
import { LawSheet, lawTitle, type LawRef } from "../LawSheet";

interface Answer {
  answerId: string;
  interpretedAs: string;
  sentences: Sentence[];
  grounded: boolean;
  mode: "claude" | "dummy";
  safetyNote: string | null;
  cards: { id: string; title: string; author: string; publishedAt: number | null; triggerAskerName: string | null }[];
  laws: LawRef[];
}

const EXAMPLES = ["資格が無くても出来る作業はありますか？", "PF管って何回まで曲げていい？", "圧着端子の2とか3.5って何の数字？"];

export function Ask({ role }: { role: Role }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [helped, setHelped] = useState(false);
  const [sent, setSent] = useState(false);
  const [openLaw, setOpenLaw] = useState<{ id: string; quote?: string } | null>(null);

  async function submit(q = text) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr("");
    setAnswer(null);
    setHelped(false);
    setSent(false);
    try {
      const a = await call<Answer>("ask", { text: q.trim(), askerRole: role });
      setAnswer(a);
      setAsked(q.trim());
      setText("");
    } catch {
      setErr("答えを取得できませんでした。電波の良い所で、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function helpedClick() {
    if (!answer) return;
    setHelped(true);
    await call("markHelped", { answerId: answer.answerId }).catch(() => setHelped(false));
  }

  async function sendToBox() {
    setSent(true);
    await call("sendToBox", { text: asked, askerName: getName(role), askerRole: role }).catch(() => setSent(false));
  }

  const cardOf = (id?: string) => answer?.cards.find((c) => c.id === id);

  return (
    <section className="screen">
      <h1 className="screen-title">現場の疑問を、聞いてみよう</h1>
      <MicInput value={text} onChange={setText} micLabel="話して聞く" placeholder="例: VE管とPF管の支持の違いは？（話し言葉・方言のままでOK）" />
      <button className="primary" disabled={!text.trim() || busy} onClick={() => submit()}>
        {busy ? "調べています…" : "聞く"}
      </button>

      {!answer && !busy && (
        <div className="examples">
          <p className="hint">よく聞かれる質問</p>
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => submit(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {err && <p className="hint error">{err}</p>}

      {answer && (
        <div className="answer">
          <p className="interpreted">
            こう受け取りました：<strong>{answer.interpretedAs}</strong>
          </p>
          {answer.mode === "dummy" && <p className="hint">※ 試験用のダミー応答です（AIの接続前）</p>}

          {answer.sentences.map((s, i) => {
            const c = s.source === "wisdom" ? cardOf(s.cardId) : undefined;
            const law = s.source === "law" ? answer.laws.find((l) => l.id === s.lawId) : undefined;
            return (
              <div key={i} className={`sentence src-${s.source}`}>
                <span className="src-tag">
                  {SOURCE_LABEL[s.source].icon} {SOURCE_LABEL[s.source].label}
                </span>
                <p>{s.text}</p>
                {c && (
                  <p className="src-meta">
                    {c.author}の話{c.publishedAt ? `・${fmtDate(c.publishedAt)}` : ""}
                    {c.triggerAskerName ? `（きっかけ: ${c.triggerAskerName}さんの質問）` : ""}
                  </p>
                )}
                {law && (
                  <button className="law-cite" onClick={() => setOpenLaw({ id: law.id, quote: s.quote })}>
                    <q>{s.quote}</q>
                    <span className="src-meta">
                      {lawTitle(law)}・{law.edition} ›
                    </span>
                  </button>
                )}
                {s.verified && <span className="stamp">✔ 原文と一致</span>}
              </div>
            );
          })}

          {answer.safetyNote && <Notice>⚠️ {answer.safetyNote}</Notice>}
          {openLaw && <LawSheet id={openLaw.id} highlight={openLaw.quote} onClose={() => setOpenLaw(null)} />}

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
              <button className={`secondary ${helped ? "done" : ""}`} disabled={helped} onClick={helpedClick}>
                {helped ? "👍 親方に届きました" : "👍 助かった"}
              </button>
            )}
            <button className={answer.grounded ? "secondary" : "primary"} disabled={sent} onClick={sendToBox}>
              {sent ? "📮 質問箱に入れました" : answer.grounded ? "📮 親方にも聞く" : "📮 親方に聞いてみる"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
