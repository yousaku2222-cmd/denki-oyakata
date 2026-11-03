import { useState } from "react";
import { call, errorText } from "./firebase";

/** Moving to a new phone: there is no login, so the old device shows a code and the new one enters it. */
export function Transfer({ what, onMoved }: { what: string; onMoved?: () => void }) {
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function make() {
    setBusy(true);
    setMsg("");
    try {
      setCode((await call<{ code: string }>("makeTransferCode", {})).code);
    } catch (e) {
      setMsg(errorText(e, "コードを出せませんでした。もう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    setBusy(true);
    setMsg("");
    try {
      const r = await call<{ cards: number; questions: number }>("useTransferCode", { code: input });
      setMsg(`引き継ぎました（カード ${r.cards} 枚・質問 ${r.questions} 件）。`);
      setInput("");
      onMoved?.();
    } catch (e) {
      const m = (e as { message?: string }).message ?? "";
      setMsg(/[ぁ-んァ-ン一-龥]/.test(m) ? m : errorText(e, "引き継げませんでした。もう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="transfer">
      <summary>📱 端末を変える時（{what}の引き継ぎ）</summary>
      <p className="hint">
        ログインが無いので、{what}はこの端末に結びついています。ブラウザのデータを消すと分からなくなります（iPhone はホーム画面に追加しておくと消えにくくなります）。
      </p>
      <p className="hint">前の端末で「コードを出す」→ 新しい端末でそのコードを入れてください（24時間・1回だけ有効）。</p>
      {code ? (
        <p className="transfer-code">{code.replace(/(.{5})/, "$1 ")}</p>
      ) : (
        <button className="secondary" disabled={busy} onClick={make}>
          この端末のコードを出す
        </button>
      )}
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="前の端末のコード" autoCapitalize="characters" maxLength={20} />
        <button className="secondary" disabled={busy || input.trim().length < 8} onClick={use}>
          引き継ぐ
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </details>
  );
}
