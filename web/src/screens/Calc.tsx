import { useEffect, useState } from "react";
import { call, errorText } from "../firebase";
import { CalcCard, type CalcOutput } from "../CalcCard";

interface Field {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  unit?: string;
  options?: { value: string; label: string; short?: string }[];
  default?: number | string | boolean;
  min?: number;
  max?: number;
  help?: string;
  optionsBy?: { key: string; map: Record<string, { value: string; label: string; short?: string }[]> };
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
// What each calculation tells you, in words for the list (the descriptions are written for the AI and carry formulas)
const LEAD: Record<string, string> = {
  conduit_fill: "電線管に電線が何本入るか、どの太さの管が要るか",
  voltage_drop: "電線が長い時に電圧がどれだけ下がるか、その太さで足りるか",
  wire_ampacity: "電線にどれだけ電流を流してよいか",
  wire_for_load: "機器の kW から、要る電線の太さ",
  branch_wire: "分岐回路のブレーカに合う電線の太さ",
  cable_rack_layout: "ケーブルラックにケーブルがどう並ぶか、必要な幅",
  insulation_check: "絶縁抵抗の測った値が、基準を満たすか",
  grounding_check: "接地抵抗の測った値が、基準を満たすか",
  support_spacing: "電線管やケーブルを何mごとに留めるか",
  rack_support_spacing: "ケーブルラックを何mごとに支えるか",
  license_scope: "持っている資格で、その工事ができるか",
  engineer_requirement: "工事の金額で、監理技術者や専任が要るか",
};

// the list is a grid of pictures and short names; what each one does is said on its own screen
const TILE: Record<string, [string, string]> = {
  conduit_fill: ["🔧", "管に何本入る"],
  voltage_drop: ["📉", "電圧降下"],
  wire_for_load: ["⚙️", "kWから電線の太さ"],
  wire_ampacity: ["🌡️", "許容電流"],
  branch_wire: ["🔌", "ブレーカーから電線の太さ"],
  cable_rack_layout: ["🧵", "ラックの並べ方"],
  insulation_check: ["🛡️", "絶縁抵抗の合否"],
  grounding_check: ["🌏", "接地抵抗の合否"],
  support_spacing: ["📏", "管・ケーブルを留める間隔"],
  rack_support_spacing: ["📐", "ラックを支える間隔"],
  license_scope: ["🪪", "この資格でできる工事"],
  engineer_requirement: ["👷", "監理技術者が要るか"],
};

export function Calc({ start }: { start?: { name: string; params: Record<string, string | number | boolean> } | null }) {
  const [defs, setDefs] = useState<CalcDef[] | null>(null);
  const [cur, setCur] = useState<CalcDef | null>(null);
  useEffect(() => {
    call<{ calcs: CalcDef[] }>("listCalcs", {})
      .then((r) => {
        setDefs(r.calcs);
        // opened from 撮る with what was read from the photo
        const d = start && r.calcs.find((c) => c.name === start.name);
        if (d) setCur(d);
      })
      .catch(() => setDefs([]));
  }, []);

  if (cur) return <CalcForm def={cur} preset={start?.name === cur.name ? start.params : undefined} onBack={() => setCur(null)} />;
  return (
    <section className="screen">
      <h1 className="screen-title">計算・判定</h1>
      <div className="hint">
        使う物を選んでください。
        <details className="more-info">
          <summary>？</summary>
          「聞く」で話しかけても使えます（例: 三相200Vで絶縁抵抗0.15MΩは大丈夫？）。
        </details>
      </div>
      {defs === null && <p className="hint">読み込み中…</p>}
      <div className="calc-tiles">
        {defs?.map((d) => (
          <button key={d.name} className="calc-tile" onClick={() => setCur(d)} title={LEAD[d.name] ?? d.description}>
            <span className="calc-icon" aria-hidden>
              {TILE[d.name]?.[0] ?? "🧮"}
            </span>
            <span>{TILE[d.name]?.[1] ?? d.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const slotNo = (key: string) => {
  const m = key.match(/\D(\d+)$/);
  return m ? Number(m[1]) : null;
};
// A slot is an optional select numbered 2 or more (wire2, cable3 …); the fields with the same number go with it.
function slotOf(f: Field) {
  const n = slotNo(f.key);
  return f.type === "select" && f.default === undefined && n !== null && n >= 2 ? n : null;
}
const isCount = (f: Field) => f.type === "number" && (f.unit === "本" || f.unit === "条");

function CalcForm({ def, onBack, preset }: { def: CalcDef; onBack: () => void; preset?: Record<string, string | number | boolean> }) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      def.fields.map((f) => {
        const v = preset?.[f.key] ?? f.default;
        return [f.key, v === undefined ? "" : typeof v === "boolean" ? v : String(v)];
      }),
    ),
  );
  const [result, setResult] = useState<CalcOutput | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // "あれば" fields (電線2・ケーブル3 …) stay hidden until 追加 is pressed
  const slots = [...new Set(def.fields.map(slotOf).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  const [opened, setOpened] = useState(0);

  const hiddenSlot = (f: Field) => {
    const n = slotNo(f.key);
    return n !== null && slots.includes(n) && slots.indexOf(n) >= opened;
  };
  const shown = (f: Field) => (!f.showIf || f.showIf.values.includes(String(values[f.showIf.key]))) && !hiddenSlot(f);
  const nextSlot = slots[opened];
  const slotName = (def.fields.find((f) => slotOf(f) === slots[0])?.label ?? "").replace(/\d.*$/, "");

  // changing a field clears the fields whose options depend on it
  function change(key: string, v: string | boolean) {
    const next = { ...values, [key]: v };
    for (const f of def.fields) if (f.optionsBy?.key === key) next[f.key] = "";
    setValues(next);
  }
  function openSlot() {
    const next = { ...values };
    for (const f of def.fields) if (slotNo(f.key) === nextSlot && f.type === "number" && next[f.key] === "") next[f.key] = "1";
    setValues(next);
    setOpened(opened + 1);
  }
  function closeSlot() {
    const n = slots[opened - 1];
    const next = { ...values };
    for (const f of def.fields) if (slotNo(f.key) === n) next[f.key] = "";
    setValues(next);
    setOpened(opened - 1);
  }
  const step = (f: Field, d: number) => {
    const n = (Number(values[f.key]) || 0) + d;
    setValues({ ...values, [f.key]: String(Math.min(f.max ?? 999, Math.max(f.min ?? 0, n))) });
  };

  async function run() {
    setErr("");
    setResult(null);
    const sent = def.fields.filter((f) => shown(f) && String(values[f.key]).trim() !== "");
    // ０．８ (full width) → 0.8; anything else that is not a number is an error, never silently the default
    const toNum = (v: string | boolean) => Number(String(v).normalize("NFKC").trim());
    const badField = sent.find((f) => f.type === "number" && !Number.isFinite(toNum(values[f.key])));
    if (badField) {
      setErr(`${badField.label}を数字で入れてください`);
      return;
    }
    setBusy(true);
    const params = Object.fromEntries(sent.map((f) => [f.key, f.type === "number" ? toNum(values[f.key]) : values[f.key]]));
    try {
      setResult((await call<{ result: CalcOutput }>("calc", { name: def.name, params })).result);
    } catch (e) {
      setErr(errorText(e, "計算できませんでした。電波の良い所で、もう一度お試しください"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <button className="link" onClick={onBack}>
        ← 一覧へ
      </button>
      <h1 className="screen-title">
        {TILE[def.name]?.[0] ?? "🧮"} {def.label}
      </h1>
      {LEAD[def.name] && <p className="hint">{LEAD[def.name]}</p>}
      {def.fields.filter(shown).map((f) =>
        f.type === "boolean" ? (
          <label key={f.key} className="toggle">
            <input type="checkbox" checked={values[f.key] === true} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
            {f.label}
          </label>
        ) : (
          <div key={f.key} className="field">
            <span>
              {f.label}
              {f.unit && !isCount(f) ? `（${f.unit}）` : ""}
            </span>
            {f.type === "select" ? (
              <Chips f={f} noEmpty={slotOf(f) !== null} value={String(values[f.key] ?? "")} parent={f.optionsBy ? String(values[f.optionsBy.key]) : undefined} onPick={(v) => change(f.key, v)} />
            ) : isCount(f) ? (
              <div className="stepper">
                <button type="button" aria-label="減らす" onClick={() => step(f, -1)}>
                  −
                </button>
                <input inputMode="numeric" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                <span>{f.unit}</span>
                <button type="button" aria-label="増やす" onClick={() => step(f, 1)}>
                  ＋
                </button>
              </div>
            ) : (
              <input inputMode="decimal" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            )}
            {f.help && <small className="hint">{f.help}</small>}
          </div>
        ),
      )}
      {slots.length > 0 && (
        <div className="slot-buttons">
          {nextSlot !== undefined && (
            <button type="button" className="opt add" onClick={openSlot}>
              ＋ {slotName}を追加
            </button>
          )}
          {opened > 0 && (
            <button type="button" className="opt" onClick={closeSlot}>
              × 最後の{slotName}を外す
            </button>
          )}
        </div>
      )}
      {err && <p className="hint error">{err}</p>}
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "計算しています…" : "計算する"}
      </button>
      {result && <CalcCard c={result} />}
    </section>
  );
}

// Wire and cable lists are long: pick the kind first, then the size.
const KINDS: Record<string, string> = { IV: "IV", VVF: "VVF", CV1: "CV 単心", CV3: "CV 3心", CVT: "CVT", HVCVT: "6600V CVT" };
const kindOf = (value: string) => {
  const k = value.split("-")[0];
  return KINDS[k] ? k : null;
};

/** A select drawn as tap buttons. */
function Chips({ f, value, parent, onPick, noEmpty }: { f: Field; value: string; parent?: string; onPick: (v: string) => void; noEmpty?: boolean }) {
  const opts = (f.optionsBy && parent !== undefined ? f.optionsBy.map[parent] : undefined) ?? f.options!;
  const twoStep = opts.length > 12 && opts.every((o) => kindOf(o.value));
  const [kind, setKind] = useState(() => (value ? kindOf(value) : null) ?? (twoStep ? kindOf(opts[0].value) : null));
  const empty = f.default === undefined && !noEmpty ? [{ value: "", label: f.emptyLabel?.replace(/[（）]/g, "") ?? "なし" }] : [];
  const text = (o: { label: string; short?: string }) => o.short ?? o.label;
  const chip = (o: { value: string; label: string; short?: string }, shown = text(o), extra = "") => (
    <button type="button" key={o.value || "none"} className={`opt${extra}${o.value === value ? " on" : ""}`} onClick={() => onPick(o.value)}>
      {shown}
    </button>
  );
  if (!twoStep) return <div className={`opts-row${opts.some((o) => text(o).length > 14) ? " wide" : ""}`}>{[...empty, ...opts].map((o) => chip(o))}</div>;
  const kinds = [...new Set(opts.map((o) => kindOf(o.value)!))];
  return (
    <>
      <div className="opts-row">
        {empty.map((o) => chip(o))}
        {kinds.map((k) => (
          <button type="button" key={k} className={`opt kind${k === kind ? (kindOf(value) === k ? " on" : " sel") : ""}`} onClick={() => setKind(k)}>
            {KINDS[k]}
          </button>
        ))}
      </div>
      <div className="opts-row sizes">{opts.filter((o) => kindOf(o.value) === kind).map((o) => chip(o, o.value.slice(o.value.indexOf("-") + 1)))}</div>
    </>
  );
}
