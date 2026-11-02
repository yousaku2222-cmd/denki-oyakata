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

/** Appends what was heard to the text via onText(final, interim). */
export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const r = makeRecognition();
    if (!r) {
      setError("この端末では音声入力が使えません。文字で入力してください。");
      return;
    }
    setError("");
    r.lang = "ja-JP";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setError("マイクの使用が許可されていません。設定で許可するか、文字で入力してください。");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("音声をうまく聞き取れませんでした。");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);
  return { listening, interim, error, start, stop };
}
