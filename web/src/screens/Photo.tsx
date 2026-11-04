import { useRef, useState } from "react";
import { motion } from "motion/react";
import { useFlyToMe } from "../FlyToMe";
import { call, errorText } from "../firebase";
import { addPart, getName } from "../local";
import { LawSheet } from "../LawSheet";
import { MicInput } from "../components";
import { FlowSteps } from "../FlowSteps";

export interface CalcStart {
  name: string;
  params: Record<string, string | number | boolean>;
}
interface PartResult {
  verdict: "sure" | "likely" | "unknown";
  name: string;
  fieldNames: string[];
  use: string;
  candidates: { name: string; hint: string }[];
  printed: string;
  zoomed: number;
  confusables: { name: string; diff: string }[];
  companions: string[];
  askIdeas?: string[]; // questions for the veteran that fit this part
  cards: { id: string; title: string; body: string; reason: string; caution: string; author: string }[];
  laws: { id: string; label: string; summary: string }[];
  calc: ({ label: string } & CalcStart) | null;
  safetyNote?: string | null;
}

const SAY = {
  sure: "✅ ほぼ間違いない",
  likely: "🤔 たぶんこれ（印字・型番で確かめてください）",
  unknown: "❓ 分かりません。近いものを選んでください",
};

/** Shrinks a photo on the device before sending: the long side to `size` px, as a JPEG data URL. */
async function shrink(file: Blob, size: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bmp.close(); // a full-size camera bitmap is large; free it now, not at GC
  }
}

// ready-made ways to ask about a photo (a tap puts one in the box, to send or rewrite)
// what a photo cannot settle (the name and use are already in the answer above): the way it is used on this site
const PHOTO_QUESTIONS = ["このつなぎ方で合ってますか？", "この場所で使って大丈夫ですか？", "この取り付け方で大丈夫ですか？", "ほかに気をつけることは？"];

/** ⑤ 撮る: photo of a part → name, use, and the way on to cards, rules and a calculation. */
export function Photo({ onCalc }: { onCalc: (s: CalcStart) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const askBox = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<PartResult | null>(null);
  const [openLaw, setOpenLaw] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [q, setQ] = useState(""); // what to ask the veteran about this photo (a draft is put in, free to rewrite)
  const { fly, envelope } = useFlyToMe();

  async function identify(body: { image?: string; name?: string }, thumbFrom: Blob | null) {
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await call<PartResult>("identifyPart", body);
      setRes(r);
      setQ(r.name && r.verdict !== "unknown" ? `これは「${r.name}」で合っていますか？使い方も教えてください。` : "これは何という部材ですか？使い方も教えてください。");
      if (r.name && r.verdict !== "unknown") addPart({ name: r.name, use: r.use, at: Date.now(), thumb: thumbFrom ? await shrink(thumbFrom, 160, 0.7) : "", fieldNames: r.fieldNames, printed: r.printed, confusables: r.confusables, companions: r.companions });
    } catch (e) {
      setErr(errorText(e, "調べられませんでした。電波の良い所で、もう一度撮ってください"));
    } finally {
      setBusy(false);
    }
  }

  async function picked(f: File | undefined) {
    if (!f) return;
    setSent(false);
    setErr("");
    let small: string;
    try {
      small = await shrink(f, 1600, 0.85);
    } catch {
      // e.g. a HEIC file the browser cannot open
      setErr("この写真は開けませんでした。カメラで撮り直すか、別の写真を選んでください");
      return;
    }
    setFile(f);
    setPreview(small);
    await identify({ image: small }, f);
  }

  async function askVeteran(e: React.MouseEvent<HTMLButtonElement>) {
    if (!file || !q.trim()) return;
    const from = e.currentTarget.getBoundingClientRect();
    setBusy(true);
    try {
      // the box takes up to 300,000 characters: step the size down for busy photos
      let photo = await shrink(file, 1024, 0.7);
      if (photo.length > 290_000) photo = await shrink(file, 800, 0.6);
      await call("sendToBox", { text: q.trim(), photo, photoPart: res && res.verdict !== "unknown" ? res.name : "", askerName: getName("young"), askerRole: "young" });
      setSent(true);
      fly(from);
    } catch (e) {
      setErr(errorText(e, "送れませんでした。もう一度お試しください"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <h1 className="screen-title">撮って調べる</h1>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
          picked(e.target.files?.[0]);
          e.target.value = ""; // so choosing the same photo again still fires onChange
        }} />
      <button className="mic" disabled={busy} onClick={() => input.current?.click()}>
        📷 {preview ? "もう一度撮る" : "部材を撮る"}
      </button>
      <p className="hint">印字や型番が写るように撮ると、読み取って確かめます。写真の一覧からも選べます。</p>
      {!preview && (
        <div className="photo-sample">
          <FlowSteps
            label="撮ると分かること"
            steps={[
              { icon: "📷", label: "撮る" },
              { icon: "🔍", label: "名前と\n使い方" },
              { icon: "🧰", label: "知恵と\n条文" },
              { icon: "📮", label: "親方に\n聞ける" },
            ]}
          />
          <details className="more-info">
            <summary>？ くわしく</summary>
            部材の名前と現場での呼び名（例：ねじなしボックスコネクタ ＝「ねじなしコネクタ」）、何に使うか・一緒に使う物・間違えやすい部材、関係する親方の知恵カードと条文、そのまま使える計算が出ます。分からない時は、写真ごと親方に聞けます。
          </details>
        </div>
      )}

      {preview && (
        <div className="photo-frame">
          <img className="photo-preview" src={preview} alt="撮った写真" />
          {/* while it is being read: a scan line runs over the photo (only while identifying, not while sending) */}
          {busy && !res && (
            <>
              <motion.div className="scan-line" aria-hidden initial={{ top: "0%" }} animate={{ top: ["0%", "100%", "0%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
              <span className="scan-corner tl" aria-hidden />
              <span className="scan-corner tr" aria-hidden />
              <span className="scan-corner bl" aria-hidden />
              <span className="scan-corner br" aria-hidden />
            </>
          )}
        </div>
      )}
      {busy && <p className="hint">調べています…（小さい印字は拡大して読み直します）</p>}
      {err && <p className="hint error">{err}</p>}

      {res && (
        <div className="part-card">
          <span className="src-tag general">📷 写真からのAIの判定（印字・現物で確かめてください）</span>
          <p className={`part-verdict ${res.verdict}`}>{SAY[res.verdict]}</p>
          {res.name && <p className="part-name">{res.name}</p>}
          {res.fieldNames.length > 0 && <p className="src-meta">現場の呼び名：{res.fieldNames.join("・")}</p>}
          {res.use && <p>{res.use}</p>}
          {res.printed && (
            <p className="part-printed">
              🔍 読み取った印字{res.zoomed ? "（拡大して読み直し）" : ""}：{res.printed}
            </p>
          )}
          {res.candidates.length > 0 && (
            <div className="opts-row wide">
              {res.candidates.map((c) => (
                <button key={c.name} className="opt" disabled={busy} onClick={() => identify({ name: c.name }, file)}>
                  <strong>{c.name}</strong>
                  <br />
                  <small>{c.hint}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {res && file && res.verdict !== "unknown" && !sent && (
        // the name alone feels like the answer: say what only a veteran can tell, right where it is read
        <div className="photo-bridge">
          <p>
            名前は写真で分かります。でも<strong>「この現場で、この使い方で合ってるか」</strong>は親方にしか分かりません。
          </p>
          {res.cards.length === 0 && <p className="src-meta">この部材の親方の知恵はまだありません。聞くと答えがカードになり、次の人にも残ります。</p>}
          <button className="secondary" onClick={() => askBox.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            📮 この写真を親方に見てもらう ↓
          </button>
        </div>
      )}

      {res && res.verdict !== "unknown" && (
        <>
          {res.calc && (
            <button className="primary" onClick={() => onCalc(res.calc!)}>
              🧮 {res.calc.label}
            </button>
          )}
          {res.cards.map((c) => (
            <details key={c.id} className="part-link wisdom">
              <summary>
                <span className="src-tag wisdom">🧰 親方の知恵</span> {c.title}
              </summary>
              <p>{c.body}</p>
              {c.reason && <p className="src-meta">理由：{c.reason}</p>}
              {c.caution && <p className="src-meta">新人がやりがち：{c.caution}</p>}
              <p className="src-meta">{c.author}</p>
            </details>
          ))}
          {res.laws.map((l) => (
            <button key={l.id} className="law-cite" onClick={() => setOpenLaw(l.id)}>
              <span className="src-tag law">⚖️ 法令・基準</span> <strong>{l.label}</strong>
              <span className="clamp2">{l.summary}</span>
              <span className="src-meta">押すと条文の全文 ›</span>
            </button>
          ))}
          {res.confusables.length > 0 && (
            <div className="part-link">
              <p className="part-sub">
                ⚠️ 間違えやすい相手 <span className="src-tag general">💡 一般知識（要確認）</span>
              </p>
              {res.confusables.map((c) => (
                <p key={c.name}>
                  <strong>{c.name}</strong>：{c.diff}
                </p>
              ))}
            </div>
          )}
          {res.companions.length > 0 && (
            <div className="part-link">
              <p className="part-sub">
                🔩 一緒に使う物 <span className="src-tag general">💡 一般知識（要確認）</span>
              </p>
              <p>{res.companions.join("・")}</p>
            </div>
          )}
        </>
      )}

      {res?.safetyNote && <p className="notice">⚠️ {res.safetyNote}</p>}
      {res && file && (
        <div className="photo-ask" ref={askBox}>
          <h2 className="sub">📷 現場で使う前に、親方に見てもらう</h2>
          {sent ? (
            <p className="hint">📮 写真と質問を、親方の質問箱に届けました。親方が答えると「わたし」に届きます。</p>
          ) : (
            <>
              <MicInput value={q} onChange={setQ} maxLength={500} rows={3} micLabel="話して入力" placeholder="例: このつなぎ方で合ってますか？" />
              <div className="examples">
                {(res.askIdeas?.length ? res.askIdeas : PHOTO_QUESTIONS).map((x) => (
                  <button key={x} className="chip" onClick={() => setQ(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <button className="primary" disabled={busy || !q.trim()} onClick={askVeteran}>
                📮 写真ごと親方に聞く
              </button>
            </>
          )}
        </div>
      )}
      {envelope}
      {openLaw && <LawSheet id={openLaw} onClose={() => setOpenLaw(null)} />}
    </section>
  );
}
