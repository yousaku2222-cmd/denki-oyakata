import { useCallback, useEffect, useRef, useState } from "react";

// Browser speech recognition (Chrome on Android, Safari on iOS). Audio is never stored: only text.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function makeRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export const speechSupported = () => makeRecognition() !== null;

// The listener's question, read out (a veteran on site may not look at the screen). Nothing is sent anywhere.
export const canSay = () => typeof window !== "undefined" && "speechSynthesis" in window;
export function say(text: string) {
  if (!canSay() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
export function hush() {
  if (canSay()) speechSynthesis.cancel();
}
// iPhone reads out only what was started by a tap: a silent word on the first tap lets the later questions
// (which arrive after the network) be read out too
let unlocked = false;
export function unlockSay() {
  if (unlocked || !canSay()) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Appends what was heard to the text via onText(final, interim); onEnd when listening has stopped (all heard). */
export function useSpeech(onFinal: (text: string) => void, onEnd?: () => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  // stopped by a press (or by leaving the screen): anything else is the browser stopping by itself
  const stopped = useRef(false);
  const failed = useRef(false);

  const stop = useCallback(() => {
    stopped.current = true;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const r = makeRecognition();
    if (!r) {
      setError("この端末では音声入力が使えません。文字で入力してください。");
      return;
    }
    setError("");
    stopped.current = false;
    failed.current = false;
    // a result already taken is not taken again (Chrome on Android may send the same one twice)
    const taken = new Set<number>();
    unlockSay(); // this press is the tap that lets the next question be read out
    hush(); // the mic would hear the question being read out
    r.lang = "ja-JP";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          if (!taken.has(i)) finalRef.current(res[0].transcript);
          taken.add(i);
        } else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") failed.current = true;
      if (e.error === "not-allowed") setError("マイクの使用が許可されていません。設定で許可するか、文字で入力してください。");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("音声をうまく聞き取れませんでした。");
    };
    r.onend = () => {
      // Chrome on Android stops after a few silent seconds: say so, or the next words are said to no one
      if (!stopped.current && !failed.current) setError("聞き取りが止まりました。続けて話す時は、もう一度🎤を押してください。");
      setListening(false);
      setInterim("");
      endRef.current?.();
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);
  return { listening, interim, error, start, stop };
}
