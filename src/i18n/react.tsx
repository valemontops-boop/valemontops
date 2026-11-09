"use client";
import * as React from "react";
import { dateTag, tFor, type Locale, type T } from "./index";

const Ctx = React.createContext<Locale>("fr");
/** Last locale rendered by the provider: default for plain date helpers called outside components. */
let current: Locale = "fr";
export const currentDateTag = () => dateTag(current);
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  // Plain date helpers (fmtDay, fmtDateTime) read this default; one founder per browser, so a render-time write is safe.
  // eslint-disable-next-line react-hooks/globals
  current = locale;
  React.useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}
export const useLocale = () => React.useContext(Ctx);
/** t("English source", { vars }) → the founder's language. */
export function useT(): T {
  const l = useLocale();
  return React.useMemo(() => tFor(l), [l]);
}
/** "fr-FR" / "es-ES" for dates and numbers. */
export const useDateTag = () => dateTag(useLocale());
