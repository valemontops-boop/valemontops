// Browser-only stand-in for next/navigation inside the static feedback preview.
// The artifact frame only passes a plain "#name" hash, so the route is the hash name and
// any query (e.g. ?account=) is kept in memory.
import { useMemo, useSyncExternalStore } from "react";

let path = routeFromHash();
let query = new URLSearchParams();
const subs = new Set<() => void>();

function routeFromHash() {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  return ["my-day", "crm", "crm-import", "settings", "command-center", "tasks", "agenda", "ideas", "files", "marketing", "reports", "call"].includes(h) ? "/" + h.replace("crm-import", "crm/import") : "/my-day";
}
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    path = routeFromHash();
    subs.forEach((s) => s());
  });
}
export function navigate(href: string) {
  const [p, q = ""] = href.split("?");
  path = p || "/my-day";
  query = new URLSearchParams(q);
  try {
    const name = path.replace(/^\//, "").replace("/", "-");
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  } catch {
    /* hash is a convenience only */
  }
  subs.forEach((s) => s());
  window.scrollTo?.(0, 0);
}
const subscribe = (cb: () => void) => (subs.add(cb), () => subs.delete(cb));
export function usePathname() {
  return useSyncExternalStore(subscribe, () => path, () => path);
}
export function useSearchParams() {
  const q = useSyncExternalStore(subscribe, () => query.toString(), () => "");
  return useMemo(() => new URLSearchParams(q), [q]);
}
export function useRouter() {
  return { push: navigate, replace: (h: string) => navigate(h), refresh: () => undefined, back: () => history.back() };
}
export function redirect(href: string): never {
  navigate(href);
  throw new Error("redirect");
}
