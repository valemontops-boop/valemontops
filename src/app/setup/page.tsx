import { Suspense } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { getConfig } from "@/server/config";
import { BOOTSTRAP_NAMES, bootstrapStatus, requestOrigin, type BootstrapName, type BootstrapVar } from "@/server/bootstrap";
import { tFor, type Locale, type T } from "@/i18n";
import { I18nProvider } from "@/i18n/react";
import { CopyValue, RecheckButton, SecretGenerator } from "@/components/setup/setup-tools";

/**
 * Public, read-only bootstrap wizard (D086): which of the few variables needed before sign-in are set or missing,
 * with where to find each one. Shows names and states only: no value is ever displayed or accepted here.
 */

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

const HELP: Record<BootstrapName, { why: string; steps: string[] }> = {
  APP_MODE: { why: "Selects real data. Value: live.", steps: ["Type live as the value (demo would only show fake data)."] },
  SESSION_SECRET: { why: "Protects the sign-in cookie: a long random value you invent, used nowhere else.", steps: ["Click “Generate a secret”, then “Copy”, and paste it as the value. Keep a copy in your password manager."] },
  APP_BASE_URL: { why: "The app's public address, used for the Google sign-in.", steps: ["Optional on Vercel: when it is not set, this deployment's address is used.", "With your own domain, set it to that address, for example https://os.example.com (no slash at the end)."] },
  FOUNDER_THEO_EMAIL: { why: "Théo's Google address: with Pablo's, the only account allowed to sign in.", steps: ["The address Théo uses to sign in to Google (Gmail or Google Workspace)."] },
  FOUNDER_PABLO_EMAIL: { why: "Pablo's Google address: with Théo's, the only account allowed to sign in.", steps: ["The address Pablo uses to sign in to Google (Gmail or Google Workspace)."] },
  FOUNDER_THEO_TIMEZONE: { why: "Théo's time zone for days, reminders and reports.", steps: ["Optional: Europe/Paris when not set."] },
  FOUNDER_PABLO_TIMEZONE: { why: "Pablo's time zone for days, reminders and reports.", steps: ["Optional: Europe/Madrid when not set."] },
  GOOGLE_OAUTH_CLIENT_ID: {
    why: "Lets the two founders sign in with Google.",
    steps: [
      "Open console.cloud.google.com with the Valemont Google account, in the Valemont OS project.",
      "Google Auth Platform › Branding: app name Valemont OS, support email = a founder's address.",
      "Audience: Internal if you are both in the same Google Workspace; otherwise External, status Testing, and add both addresses as test users.",
      "Clients › Create client › Web application. Under “Authorized redirect URIs”, paste the three addresses shown in “Google sign-in addresses” below, then Create.",
      "Copy the Client ID as the value.",
    ],
  },
  GOOGLE_OAUTH_CLIENT_SECRET: { why: "The secret that goes with the Client ID.", steps: ["Same place: Google Auth Platform › Clients › Valemont OS › Client secret. Copy it as the value."] },
  SHEETS_SPREADSHEET_ID: {
    why: "The Google Sheet that holds all the data. The app prepares its tabs itself after the first sign-in.",
    steps: [
      "On sheets.google.com, create an empty spreadsheet named Valemont OS.",
      "Share it with the service account address (see the next variable) as Editor, without notification.",
      "Copy the id from its address: docs.google.com/spreadsheets/d/<THE-ID>/edit.",
    ],
  },
  GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: {
    why: "The key of the service account, the robot that reads and writes the Sheet.",
    steps: [
      "Google Cloud › APIs & Services › Library: enable Google Sheets API, Google Drive API, Google Calendar API and Gmail API.",
      "IAM & Admin › Service accounts › Create service account: name valemont-os, no role. Note its address (…@….iam.gserviceaccount.com).",
      "Open it › Keys › Add key › Create new key › JSON: a file downloads.",
      "Open the file with a text editor, copy all its content and paste it as the value (base64 also works). Then delete the file.",
    ],
  },
};

const STATE_LABEL: Record<BootstrapVar["state"], string> = { set: "Is set", missing: "Missing", invalid: "To fix", auto: "Automatic", default: "Default value" };

function StatePill({ state, t }: { state: BootstrapVar["state"]; t: T }) {
  const tone = state === "missing" || state === "invalid" ? "bg-[#fbeceb] text-bad" : state === "set" ? "bg-[#e6f2ec] text-good" : "bg-subtle text-text-2";
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{t(STATE_LABEL[state])}</span>;
}

async function SetupBody() {
  await connection(); // read the request first: configuration is evaluated at request time, never baked into the build
  const locale = await requestLocale();
  const t = tFor(locale);
  const h = await headers();
  const cfg = getConfig();
  const vars = bootstrapStatus(process.env);
  const origin = requestOrigin(h);
  const explicitBase = Boolean((process.env.APP_BASE_URL ?? "").trim());
  const signInBase = explicitBase || !origin ? cfg.baseUrl : vars.find((v) => v.name === "APP_BASE_URL")?.state === "auto" ? cfg.baseUrl : origin;
  const todo = vars.filter((v) => v.state === "missing" || v.state === "invalid");
  const done = vars.filter((v) => !todo.includes(v));
  const other = cfg.errors.filter((e) => !BOOTSTRAP_NAMES.some((n) => e.startsWith(n)) && !e.startsWith("Service account key") && !e.startsWith("APP_MODE"));
  return (
    <I18nProvider locale={locale}>
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
          <section className="rounded-[20px] bg-panel p-6">
            <p className="font-medium">{t("Configuration is complete.")}</p>
            <p className="mt-1 text-sm text-text-2">{t("At the first sign-in, the app prepares the Google Sheet for you (Installation page, one button).")}</p>
            <a className="mt-4 inline-flex h-11 items-center rounded-full bg-accent px-6 font-medium text-on-accent hover:bg-accent-hover" href="/login">{t("Sign in")}</a>
          </section>
        ) : (
          <>
            <section className="rounded-[20px] bg-ink p-6 text-panel">
              <h2 className="font-semibold">{t("Where to add a variable")}</h2>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm">
                <li>{t("vercel.com › your project › Settings › Environment Variables › Add: the name exactly as written below, its value, environment Production. Tick Sensitive for secrets.")}</li>
                <li>{t("Then Deployments › ⋯ › Redeploy (a variable is only read by the next deployment).")}</li>
                <li>{t("Come back to this page and click “Check again”.")}</li>
              </ol>
              <p className="mt-3 text-[13px] opacity-80">{t("This page only shows whether each variable is set. It never shows or asks for a value: secrets go into Vercel only, never into a chat or an email.")}</p>
            </section>

            <section className="rounded-[20px] bg-panel p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{t("Still to do ({n})", { n: todo.length })}</h2>
                <RecheckButton />
              </div>
              <ul className="mt-4 flex flex-col gap-5">
                {todo.map((v) => (
                  <li key={v.name} data-var={v.name} className="border-t border-hairline pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-semibold">{v.name}</code>
                      <StatePill state={v.state} t={t} />
                    </div>
                    <p className="mt-1 text-sm">{t(HELP[v.name].why)}</p>
                    {v.problem ? <p className="mt-1 text-sm text-bad">{t(v.problem)}</p> : null}
                    <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-text-2">
                      {HELP[v.name].steps.map((s) => <li key={s}>{t(s)}</li>)}
                    </ol>
                    {v.name === "SESSION_SECRET" ? <SecretGenerator /> : null}
                    {v.name === "APP_BASE_URL" && origin ? (
                      <div className="mt-2 text-sm">
                        {t("Address detected for this page:")}
                        <CopyValue value={origin} label="APP_BASE_URL" />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {other.length ? (
                <ul className="mt-4 flex list-disc flex-col gap-1 border-t border-hairline pt-4 pl-5 text-sm text-bad">
                  {other.map((e) => <li key={e}>{t(e)}</li>)}
                </ul>
              ) : null}
            </section>

            <section className="rounded-[20px] bg-panel p-6">
              <h2 className="font-semibold">{t("Google sign-in addresses")}</h2>
              <p className="mt-1 text-sm text-text-2">{t("Paste these three addresses exactly in Google Auth Platform › Clients › Valemont OS › Authorized redirect URIs.")}</p>
              {["/api/auth/google/callback", "/api/auth/google/drive/callback", "/api/auth/google/gmail/callback"].map((p) => (
                <CopyValue key={p} value={`${signInBase}${p}`} label={t("Redirect URI")} />
              ))}
              {!explicitBase && origin && signInBase !== origin ? (
                <p className="mt-2 text-[13px] text-text-3">{t("These use the production address of the project. If you open the app at another address, set APP_BASE_URL to it.")}</p>
              ) : null}
            </section>

            <section className="rounded-[20px] bg-panel p-6">
              <h2 className="font-semibold">{t("Already done ({n})", { n: done.length })}</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {done.map((v) => (
                  <li key={v.name} data-var={v.name} className="flex flex-wrap items-center justify-between gap-2">
                    <code>{v.name}</code>
                    <StatePill state={v.state} t={t} />
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-sm text-text-2">{t("Full guide: docs/SETUP_GUIDE.md. To try the app without credentials, set APP_MODE=demo.")}</p>
          </>
        )}
      </div>
    </I18nProvider>
  );
}
