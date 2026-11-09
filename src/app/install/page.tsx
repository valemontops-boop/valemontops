import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireSessionOrRedirect } from "@/server/auth";
import { getConfig } from "@/server/config";
import { LOCALE_OF } from "@/i18n";
import { I18nProvider } from "@/i18n/react";
import { InstallView } from "@/components/app/install-view";

/** D086: first-run Installation (LIVE): one button prepares the Google Sheet, no terminal needed. Founders only. */
export default function InstallPage() {
  return (
    <main className="mx-auto max-w-2xl p-4 py-10">
      <Suspense fallback={<div className="p-6 text-sm text-text-2" aria-busy="true">…</div>}>
        <Body />
      </Suspense>
    </main>
  );
}

async function Body() {
  const session = await requireSessionOrRedirect(); // reads the request first, then the configuration
  if (getConfig().mode !== "live") redirect("/my-day");
  return (
    <I18nProvider locale={LOCALE_OF[session.founder]}>
      <InstallView />
    </I18nProvider>
  );
}
