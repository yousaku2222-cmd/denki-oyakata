import { useEffect, useState } from "react";

// The script this page was built with (its name changes with every build).
const scriptOf = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
const mine = () => scriptOf(document.documentElement.innerHTML) ?? [...document.scripts].map((s) => scriptOf(s.src)).find(Boolean) ?? null;
// found once, it stays found: the entry's note and the app's note are not the same one
let found = false;

/**
 * From the home screen an iPhone resumes the page as it was, so a new version never arrives by itself. On
 * coming back, ask the server for its page; if it is built from another script, say so (a tap reloads, never by
 * itself: a story half told would be lost).
 */
export function UpdateNote({ dirty = false }: { dirty?: boolean }) {
  const [newer, setNewer] = useState(found);
  useEffect(() => {
    const here = mine();
    if (!here) return; // the dev server: nothing to compare
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/", { cache: "no-store" })
        .then((r) => r.text())
        .then((html) => {
          const there = scriptOf(html);
          if (there && there !== here) {
            found = true;
            setNewer(true);
          }
        })
        .catch(() => {}); // offline: try again next time
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  if (!newer) return null;
  return (
    <button className="update-note" onClick={() => (!dirty || confirm("「話す」で話している途中の内容は消えます。更新しますか？")) && location.reload()}>
      ✨ 新しい版があります（押すと更新）
    </button>
  );
}
