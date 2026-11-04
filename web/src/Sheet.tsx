import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sheet over the screen (an article, a word's meaning). Esc and the backdrop close it; the focus goes into it
 * and comes back to what opened it, and Tab stays inside while it is open.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(".sheet-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !box.current) return;
      const all = [...box.current.querySelectorAll<HTMLElement>("button, a[href], summary, input, textarea, [tabindex]")].filter((x) => !x.hasAttribute("disabled"));
      if (!all.length) return;
      const [first, last] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section ref={box} className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}>
        <button className="link sheet-close" onClick={onClose}>
          ✕ 閉じる
        </button>
        {children}
      </section>
    </div>
  );
}
