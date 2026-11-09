import { Suspense } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { getConfig } from "@/server/config";
import { tFor, type Locale } from "@/i18n";

/** No founder is signed in here: Spanish when the browser asks for it, French otherwise. */
async function requestLocale(): Promise<Locale> {
  const lang = (await headers()).get("accept-language") ?? "";
  return lang.trim().toLowerCase().startsWith("es") ? "es" : "fr";
}

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-2xl p-4 py-10">
      <Suspense fallback={null}>
        <SetupBody />
      </Suspense>
    </main>
  );
}

const STEPS = [
  "Create a private Google Sheet titled “Valemont OS — Production Data” with a founder account (a service account cannot create it).",
  "In Google Cloud: create a project, enable the Google Sheets API, create a service account and a JSON key.",
  "Share the Sheet with the service account email as Editor.",
  "Create an OAuth client (Web application) with redirect URI <APP_BASE_URL>/api/auth/google/callback.",
  "Set the environment variables listed below on the host (never in source code or chat).",
  "Run `npm run setup:sheets`, then `npm run doctor:sheets`, then restart the app.",
];

async function SetupBody() {
  await connection();
  const t = tFor(await requestLocale());
  const cfg = getConfig();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Setup required")}</h1>
        <p className="mt-1 text-text-2">
          {cfg.mode === "live"
            ? t("LIVE mode is selected but the Google configuration is incomplete. Nothing can be saved until this is fixed. The app does not fall back to DEMO.")
            : t("The app configuration is incomplete.")}
        </p>
      </div>
      {cfg.ok ? (
        <p className="rounded-[12px] bg-panel p-4">{t("Configuration is complete.")} <a className="font-medium underline" href="/login">{t("Sign in")}</a></p>
      ) : (
        <section className="rounded-[20px] bg-panel p-6">
          <h2 className="font-semibold">{t("What is missing")}</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
            {cfg.errors.map((e) => <li key={e}>{t(e)}</li>)}
          </ul>
        </section>
      )}
      <section className="rounded-[20px] bg-panel p-6">
        <h2 className="font-semibold">{t("Steps")}</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm">
          {STEPS.map((s) => <li key={s}>{t(s)}</li>)}
        </ol>
        <p className="mt-4 text-sm text-text-2">{t("Full guide: README.md, section “Connect your Google Sheet”. To try the app without credentials, set APP_MODE=demo.")}</p>
      </section>
    </div>
  );
}
