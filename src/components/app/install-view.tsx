"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Panel, PanelTitle } from "@/components/ui/form";
import { Pill } from "./bits";

/** D086: first-run "Installation" (prepare the Google Sheet from the app) and the "Check" panel of Settings › Diagnostics. */

type Access = "ok" | "forbidden" | "read_only" | "not_found" | "not_configured" | "error";
type TabState = { tab: string; state: "ok" | "missing" | "columns_missing"; missingColumns?: string[] };
type SheetStatus = { target: string; access: Access; ready: boolean; title?: string; tabs: TabState[]; error?: string };
type Status = { serviceEmail: string | null; sheets: SheetStatus[] };
type RunResult = { target: string; ok: boolean; access: Access; serviceEmail: string | null; tabs: { tab: string; result: "created" | "headers" | "columns" | "unchanged"; columns?: string[] }[]; seeded: Record<string, number>; error?: string };
type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; key: string; vars?: Record<string, string | number> };
type DoctorOut = { serviceEmail: string | null; checks: Check[]; own: SheetStatus };

type StepKey = "shared" | "own" | "doctor";
type StepState = "waiting" | "running" | "done" | "failed";

const isShared = (s: { target: string }) => s.target === "shared";

export function InstallView() {
  const t = useT();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [steps, setSteps] = React.useState<Partial<Record<StepKey, StepState>>>({});
  const [results, setResults] = React.useState<RunResult[]>([]);
  const [checks, setChecks] = React.useState<Check[] | null>(null);
  const [failure, setFailure] = React.useState<RunResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const router = useRouter();
  const load = React.useCallback(() => api<Status>("/api/install/status").then(setStatus, (e: Error) => setLoadError(e.message)), []);
  React.useEffect(() => { void load(); }, [load]);

  const own = status?.sheets.find((s) => !isShared(s));
  const ownConfigured = !!own && own.access !== "not_configured";

  async function run() {
    setRunning(true);
    setLoadError(null);
    setFailure(null);
    setChecks(null);
    setResults([]);
    setDone(false);
    const plan: StepKey[] = ownConfigured ? ["shared", "own", "doctor"] : ["shared", "doctor"];
    setSteps(Object.fromEntries(plan.map((k) => [k, "waiting"])));
    const mark = (k: StepKey, s: StepState) => setSteps((p) => ({ ...p, [k]: s }));
    let privateFailed = false;
    try {
      for (const target of ["shared", "own"] as const) {
        if (!plan.includes(target)) continue;
        mark(target, "running");
        const r = await api<RunResult>("/api/install/run", { body: { target } });
        setResults((p) => [...p, r]);
        if (!r.ok) {
          mark(target, "failed");
          // The private Sheet is optional: its problem is shown, the shared database still counts as prepared.
          setFailure(r);
          if (target === "shared") return;
          privateFailed = true;
        } else mark(target, "done");
      }
      mark("doctor", "running");
      const d = await api<DoctorOut>("/api/install/doctor", { method: "POST" });
      setChecks(d.checks);
      const failed = d.checks.some((c) => c.status === "fail");
      mark("doctor", failed ? "failed" : "done");
      if (!failed) {
        setDone(true);
        // Stay on the page when the private Sheet has a problem, so its instructions remain visible.
        if (!privateFailed) setTimeout(() => router.push("/my-day"), 2500);
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : String(e));
      setSteps((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === "running" ? "failed" : v])));
    } finally {
      setRunning(false);
      void load();
    }
  }

  const shared = status?.sheets.find(isShared);
  const allReady = !!shared && shared.access === "ok" && shared.ready && (!ownConfigured || (own?.access === "ok" && own.ready));
  const STEP_LABEL: Record<StepKey, string> = { shared: "Shared database (Google Sheet)", own: "Your private Sheet", doctor: "Final check" };
  const STEP_STATE: Record<StepState, string> = { waiting: "Waiting", running: "In progress…", done: "Done", failed: "Problem" };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Installation")}</h1>
        <p className="mt-1 text-text-2">{t("One last step: the app prepares its tabs in your Google Sheet. It never deletes or overwrites anything, and it is safe to click twice.")}</p>
      </div>

      <Panel>
        <PanelTitle>{t("Your Google Sheets")}</PanelTitle>
        {!status && !loadError ? <p className="text-sm text-text-2" aria-busy="true">{t("Checking…")}</p> : null}
        {status ? (
          <ul className="flex flex-col gap-2 text-sm">
            {status.sheets.map((s) => <SheetLine key={s.target} s={s} />)}
          </ul>
        ) : null}
        {loadError ? <p role="alert" className="mt-3 text-sm text-bad">{t(loadError)}</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="primary" onClick={run} disabled={running || !status}>{running ? t("Preparing…") : t("Prepare the database")}</Button>
          {allReady && !running ? <a href="/my-day" className="text-sm font-medium underline">{t("Everything is ready: go to My Day")}</a> : null}
        </div>
      </Panel>

      {Object.keys(steps).length ? (
        <Panel aria-live="polite">
          <PanelTitle>{t("Progress")}</PanelTitle>
          <ol className="flex flex-col gap-2 text-sm">
            {(Object.entries(steps) as [StepKey, StepState][]).map(([k, s]) => (
              <li key={k} data-step={k} className="flex items-center justify-between gap-3">
                <span>{t(STEP_LABEL[k])}</span>
                <Pill tone={s === "done" ? "good" : s === "failed" ? "bad" : s === "running" ? "dark" : "neutral"}>{t(STEP_STATE[s])}</Pill>
              </li>
            ))}
          </ol>
          {failure ? <AccessHelp access={failure.access} email={failure.serviceEmail ?? status?.serviceEmail ?? null} target={failure.target} error={failure.error} /> : null}
          {results.filter((r) => r.ok).map((r) => <TabResults key={r.target} r={r} />)}
          {checks ? <DoctorList checks={checks} /> : null}
          {done ? (
            <p role="status" className="mt-4 rounded-[12px] bg-[#e6f2ec] p-3 text-sm font-medium text-good">
              {failure ? <a href="/my-day" className="underline">{t("The shared database is ready: go to My Day")}</a> : t("The database is ready. Opening My Day…")}
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function SheetLine({ s }: { s: SheetStatus }) {
  const t = useT();
  const name = isShared(s) ? t("Shared database (Google Sheet)") : t("Your private Sheet");
  if (s.access === "not_configured") return <li className="flex justify-between gap-3"><span>{name}</span><Pill>{t("Not configured (optional)")}</Pill></li>;
  const missing = s.tabs.filter((x) => x.state === "missing").length;
  const cols = s.tabs.filter((x) => x.state === "columns_missing").length;
  return (
    <li className="flex flex-wrap justify-between gap-3">
      <span>{name}{s.title ? <span className="text-text-3"> · {s.title}</span> : null}</span>
      {s.access !== "ok" ? <Pill tone="bad">{t(ACCESS_SHORT[s.access])}</Pill>
        : s.ready ? <Pill tone="good">{t("Ready")}</Pill>
          : <Pill tone="bad">{t("{n} tabs to create, {m} to update", { n: missing, m: cols })}</Pill>}
    </li>
  );
}

const ACCESS_SHORT: Record<Access, string> = { ok: "Ready", forbidden: "Not shared with the app", read_only: "Shared as read-only", not_found: "Sheet not found", not_configured: "Not configured (optional)", error: "Google did not answer" };

/** What to do when the service account cannot use a Sheet: the exact address to share it with, as Editor. */
export function AccessHelp({ access, email, target, error }: { access: Access; email: string | null; target: string; error?: string }) {
  const t = useT();
  const idVar = target === "shared" ? "SHEETS_SPREADSHEET_ID" : target === "theo" ? "PRIVATE_SHEET_ID_THEO" : "PRIVATE_SHEET_ID_PABLO";
  if (access === "forbidden" || access === "read_only") {
    return (
      <div role="alert" className="mt-4 rounded-[12px] bg-[#fbeceb] p-4 text-sm">
        <p className="font-medium text-bad">
          {access === "forbidden"
            ? t("The service account does not have Editor access to this Google Sheet.")
            : t("The service account can read this Google Sheet but not write to it: it was shared as Viewer or Commenter instead of Editor.")}
        </p>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
          <li>{t("Open the Google Sheet and click Share (top right).")}</li>
          <li>{t("Paste this address:")} {email ? <code data-testid="service-email" className="break-all font-semibold">{email}</code> : t("the service account address (Google Cloud › IAM & Admin › Service accounts)")}</li>
          <li>{t("Choose the role Editor, untick “Notify people”, then click Share.")}</li>
          <li>{t("Come back here and click “Prepare the database” again.")}</li>
        </ol>
      </div>
    );
  }
  if (access === "not_found") {
    return <p role="alert" className="mt-4 rounded-[12px] bg-[#fbeceb] p-4 text-sm text-bad">{t("Google cannot find this Sheet: check {name} in Vercel (only the id, the part of the Sheet's address between /d/ and /edit), then redeploy.", { name: idVar })}</p>;
  }
  return <p role="alert" className="mt-4 rounded-[12px] bg-[#fbeceb] p-4 text-sm text-bad">{t("Google Sheets did not answer. Wait a minute and click again.")}{error ? <span className="mt-1 block text-[12px] opacity-80">{error}</span> : null}</p>;
}

function TabResults({ r }: { r: RunResult }) {
  const t = useT();
  const n = (k: RunResult["tabs"][number]["result"]) => r.tabs.filter((x) => x.result === k).length;
  const LABEL = { created: "created", headers: "headers written", columns: "columns added", unchanged: "already ready" } as const;
  return (
    <details className="mt-4 text-sm" data-target={r.target}>
      <summary className="cursor-pointer">
        {t(r.target === "shared" ? "Shared database (Google Sheet)" : "Your private Sheet")}: {t("{n} tabs created, {m} updated, {k} already ready", { n: n("created"), m: n("headers") + n("columns"), k: n("unchanged") })}
      </summary>
      <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {r.tabs.map((x) => (
          <li key={x.tab} className="flex justify-between gap-2"><span>{x.tab}</span><span className={x.result === "unchanged" ? "text-text-3" : "text-good"}>{t(LABEL[x.result])}{x.columns ? ` (${x.columns.length})` : ""}</span></li>
        ))}
      </ul>
    </details>
  );
}

const CHECK_TONE = { ok: "good", warn: "neutral", fail: "bad" } as const;
const CHECK_LABEL = { ok: "OK", warn: "To look at", fail: "Problem" } as const;

export function DoctorList({ checks }: { checks: Check[] }) {
  const t = useT();
  return (
    <ul className="mt-4 flex flex-col gap-2 text-sm" data-testid="doctor-checks">
      {checks.map((c) => (
        <li key={c.name} className="flex flex-col gap-0.5 border-t border-hairline pt-2">
          <span className="flex items-center justify-between gap-3"><span className="font-medium">{t(c.name)}</span><Pill tone={CHECK_TONE[c.status]}>{t(CHECK_LABEL[c.status])}</Pill></span>
          <span className="text-text-2">{t(c.key, c.vars)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Settings › Diagnostics (LIVE): run the doctor again, or go back to the Installation page. */
export function InstallCheckPanel() {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState<DoctorOut | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api<DoctorOut>("/api/install/doctor", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const access = out?.checks[0]?.name === "Access" && out.checks[0].status === "fail" ? out.checks[0] : null;
  return (
    <Panel>
      <PanelTitle action={<a href="/install" className="text-sm font-medium underline">{t("Prepare the database again")}</a>}>{t("Database check")}</PanelTitle>
      <p className="text-sm text-text-2">{t("Checks sharing, tabs, headers, duplicates and a test write on the Google Sheet (same checks as doctor:sheets).")}</p>
      <Button className="mt-3" onClick={check} disabled={busy}>{busy ? t("Checking…") : t("Check")}</Button>
      {error ? <p role="alert" className="mt-3 text-sm text-bad">{t(error)}</p> : null}
      {access && out ? <AccessHelp access={access.key.startsWith("Permission") ? "forbidden" : access.key.startsWith("Spreadsheet not found") ? "not_found" : "error"} email={out.serviceEmail} target="shared" /> : null}
      {out ? <DoctorList checks={out.checks} /> : null}
      {out && out.own.access !== "not_configured" ? (
        <p className="mt-3 text-sm">{t("Your private Sheet")}: {out.own.access !== "ok" ? t(ACCESS_SHORT[out.own.access]) : out.own.ready ? t("Ready") : t("{n} tabs to create, {m} to update", { n: out.own.tabs.filter((x) => x.state === "missing").length, m: out.own.tabs.filter((x) => x.state === "columns_missing").length })}</p>
      ) : null}
    </Panel>
  );
}
