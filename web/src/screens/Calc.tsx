import { useEffect, useState } from "react";
import { call } from "../firebase";
import { CalcCard, type CalcOutput } from "../CalcCard";

interface Field {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  unit?: string;
  options?: { value: string; label: string }[];
  default?: number | string | boolean;
  help?: string;
  optionsBy?: { key: string; map: Record<string, { value: string; label: string }[]> };
  emptyLabel?: string;
  showIf?: { key: string; values: string[] };
}
interface CalcDef {
  name: string;
  label: string;
  description: string;
  fields: Field[];
}

/** The 計算 tab: pick one, fill the form, the server computes. */
export function Calc() {
  const [defs, setDefs] = useState<CalcDef[] | null>(null);
  const [cur, setCur] = useState<CalcDef | null>(null);
  useEffect(() => {
    call<{ calcs: CalcDef[] }>("listCalcs", {})
      .then((r) => setDefs(r.calcs))
      .catch(() => setDefs([]));
  }, []);

  if (cur) return <CalcForm def={cur} onBack={() => setCur(null)} />;
  return (
    <section className="screen">
      <h1 className="screen-title">計算・判定</h1>
      <p className="hint">「聞く」で話しかけても使えます（例: 三相200Vで絶縁抵抗0.15MΩは大丈夫？）。</p>
      {defs === null && <p className="hint">読み込み中…</p>}
      {defs?.map((d) => (
        <button key={d.name} className="card-row" onClick={() => setCur(d)}>
          <strong>🧮 {d.label}</strong>
          <span className="src-meta">{d.description.split("。")[0]}。</span>
        </button>
      ))}
    </section>
  );
}

function CalcForm({ def, onBack }: { def: CalcDef; onBack: () => void }) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(def.fields.map((f) => [f.key, f.default === undefined ? "" : typeof f.default === "boolean" ? f.default : String(f.default)])),
  );
  const [result, setResult] = useState<CalcOutput | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // changing a field clears the fields whose options depend on it
  function change(key: string, v: string | boolean) {
    const next = { ...values, [key]: v };
    for (const f of def.fields) if (f.optionsBy?.key === key) next[f.key] = "";
    setValues(next);
  }

  async function run() {
    setBusy(true);
    setErr("");
    setResult(null);
    const params = Object.fromEntries(
      Object.entries(values)
        .filter(([k, v]) => {
          const f = def.fields.find((x) => x.key === k);
          return v !== "" && (!f?.showIf || f.showIf.values.includes(String(values[f.showIf.key])));
        })
        .map(([k, v]) => [k, def.fields.find((f) => f.key === k)?.type === "number" ? Number(v) : v]),
    );
    try {
      setResult((await call<{ result: CalcOutput }>("calc", { name: def.name, params })).result);
    } catch (e) {
      setErr((e as { message?: string }).message || "計算できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <button className="link" onClick={onBack}>
        ← 一覧へ
      </button>
      <h1 className="screen-title">🧮 {def.label}</h1>
      {def.fields.filter((f) => !f.showIf || f.showIf.values.includes(String(values[f.showIf.key]))).map((f) => (
        <label key={f.key} className={f.type === "boolean" ? "toggle" : "field"}>
          {f.type === "boolean" ? (
            <>
              <input type="checkbox" checked={values[f.key] === true} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
              {f.label}
            </>
          ) : (
            <>
              <span>
                {f.label}
                {f.unit ? `（${f.unit}）` : ""}
              </span>
              {f.type === "select" ? (
                <select value={String(values[f.key] ?? "")} onChange={(e) => change(f.key, e.target.value)}>
                  {f.default === undefined && <option value="">{f.emptyLabel ?? "（なし）"}</option>}
                  {(f.optionsBy?.map[String(values[f.optionsBy.key])] ?? f.options!).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input inputMode="decimal" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </>
          )}
          {f.help && <small className="hint">{f.help}</small>}
        </label>
      ))}
      {err && <p className="hint error">{err}</p>}
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "計算しています…" : "計算する"}
      </button>
      {result && <CalcCard c={result} />}
    </section>
  );
}
