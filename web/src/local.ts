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
