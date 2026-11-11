import { useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";

type Asking = { id: number; message: string; resolve: (ok: boolean) => void };
let show: ((message: string, resolve: (ok: boolean) => void) => void) | null = null;

/**
 * The app's own 確認, in place of the browser's confirm dialog: a sheet in the screen (Sheet.tsx) with the same words.
 * Resolves true for 「はい」, false for 「やめる」, ✕, Esc and the backdrop (and when no ConfirmHost is mounted).
 */
export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => (show ? show(message, resolve) : resolve(false)));
}

/** Mounted once (main.tsx): shows what askConfirm asks. A second ask while one is open answers the first "no". */
export function ConfirmHost() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const open = useRef<Asking | null>(null);
  useEffect(() => {
    let n = 0;
    show = (message, resolve) => {
      open.current?.resolve(false);
      open.current = { id: ++n, message, resolve };
      setAsking(open.current);
    };
    return () => {
      show = null;
      // an ask left open when the host goes away is answered "no", so its caller does not wait forever
      open.current?.resolve(false);
      open.current = null;
    };
  }, []);
  if (!asking) return null;
  const answer = (ok: boolean) => {
    if (open.current !== asking) return;
    open.current = null;
    setAsking(null);
    asking.resolve(ok);
  };
  return (
    <Sheet key={asking.id} label="確認" onClose={() => answer(false)}>
      <p className="confirm-text">{asking.message}</p>
      <div className="row">
        <button className="secondary" onClick={() => answer(false)}>
          やめる
        </button>
        <button className="primary" onClick={() => answer(true)}>
          はい
        </button>
      </div>
    </Sheet>
  );
}
