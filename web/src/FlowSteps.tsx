import { Fragment } from "react";

export interface Step {
  icon: string; // an emoji, or a picture under /public (path starting with "/")
  label: string;
}

/** A row of steps joined by arrows (a column on a narrow phone): how something works, in pictures before words. */
export function FlowSteps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className={`flow-steps ${steps.length >= 4 ? "many" : ""}`} aria-label={label}>
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && (
            <li className="flow-arrow" aria-hidden>
              →
            </li>
          )}
          <li className="flow-step">
            {s.icon.startsWith("/") ? <img src={s.icon} alt="" /> : <span className="flow-icon">{s.icon}</span>}
            <span>{s.label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
