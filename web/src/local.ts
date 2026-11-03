// Per-device settings. No login: the device id is how we know "my cards" / "my questions".
export type Role = "veteran" | "young";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

export const getRole = () => get("oyakata.role") as Role | null;
export const setRole = (r: Role | null) => set("oyakata.role", r);
export const getName = (r: Role) => get(`oyakata.name.${r}`) ?? "";
export const setName = (r: Role, n: string) => set(`oyakata.name.${r}`, n);
export const getTheme = () => get("oyakata.theme") as "light" | "dark" | null;
export const setTheme = (t: "light" | "dark") => set("oyakata.theme", t);

// わたしの部材帳: the parts this device has looked up (newest first, a small picture each).
export interface PartEntry {
  name: string;
  use: string;
  at: number;
  thumb: string; // data URL, about 160px
}
export function getParts(): PartEntry[] {
  try {
    return JSON.parse(get("oyakata.parts") ?? "[]") as PartEntry[];
  } catch {
    return [];
  }
}
export function addPart(p: PartEntry) {
  const list = [p, ...getParts().filter((x) => x.name !== p.name)].slice(0, 60);
  set("oyakata.parts", JSON.stringify(list));
}

// 「審査員の方はこちら」: what this device publishes or sends is seen only by itself (see spaceOf in functions).
export const getTrial = () => get("oyakata.trial") === "1";
export const setTrial = (on: boolean) => set("oyakata.trial", on ? "1" : null);
