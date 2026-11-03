import { useRef, useState } from "react";
import { call } from "../firebase";
import { addPart, getName } from "../local";
import { LawSheet } from "../LawSheet";

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
  cards: { id: string; title: string; body: string; reason: string; caution: string; author: string }[];
  laws: { id: string; label: string; summary: string }[];
  calc: ({ label: string } & CalcStart) | null;
}

const SAY = {
  sure: "✅ ほぼ間違いない",
  likely: "🤔 たぶんこれ（印字・型番で確かめてください）",
  unknown: "❓ 分かりません。近いものを選んでください",
};

/** Shrinks a photo on the device before sending: the long side to `size` px, as a JPEG data URL. */
async function shrink(file: Blob, size: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** ⑤ 撮る: photo of a part → name, use, and the way on to cards, rules and a calculation. */
export function Photo({ onCalc }: { onCalc: (s: CalcStart) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<PartResult | null>(null);
  const [openLaw, setOpenLaw] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function identify(body: { image?: string; name?: string }, thumbFrom: Blob | null) {
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await call<PartResult>("identifyPart", body);
      setRes(r);
      if (r.name && r.verdict !== "unknown") addPart({ name: r.name, use: r.use, at: Date.now(), thumb: thumbFrom ? await shrink(thumbFrom, 160, 0.7) : "" });
    } catch (e) {
      setErr((e as { message?: string }).message || "調べられませんでした。もう一度撮ってください");
    } finally {
      setBusy(false);
    }
  }

  async function picked(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setSent(false);
    const small = await shrink(f, 1600, 0.85);
    setPreview(small);
    await identify({ image: small }, f);
  }

  async function askVeteran() {
    if (!file) return;
    setBusy(true);
    try {
      const photo = await shrink(file, 1024, 0.7);
      await call("sendToBox", { text: res?.name ? `これは「${res.name}」で合っていますか？使い方も教えてください。` : "これは何という部材ですか？使い方も教えてください。", photo, askerName: getName("young"), askerRole: "young" });
      setSent(true);
    } catch (e) {
      setErr((e as { message?: string }).message || "送れませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <h1 className="screen-title">撮って調べる</h1>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => picked(e.target.files?.[0])} />
      <button className="mic" disabled={busy} onClick={() => input.current?.click()}>
        📷 {preview ? "もう一度撮る" : "部材を撮る"}
      </button>
      <p className="hint">印字や型番が写るように撮ると、読み取って確かめます。写真の一覧からも選べます。</p>

      {preview && <img className="photo-preview" src={preview} alt="撮った写真" />}
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

      {res && file && (
        <button className="secondary" disabled={busy || sent} onClick={askVeteran}>
          {sent ? "📮 親方の質問箱に届けました" : "❓ 写真ごと親方に聞く"}
        </button>
      )}
      {openLaw && <LawSheet id={openLaw} onClose={() => setOpenLaw(null)} />}
    </section>
  );
}
