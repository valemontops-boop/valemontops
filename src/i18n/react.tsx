"use client";
import * as React from "react";
import { dateTag, tFor, type Locale, type T } from "./index";

const Ctx = React.createContext<Locale>("fr");
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
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
