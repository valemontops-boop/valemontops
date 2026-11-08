import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getConfig } from "@/server/config";

const ERRORS: Record<string, string> = {
  not_allowed: "This Google account is not one of the two founder addresses configured for Valemont OS.",
  email_unverified: "Google did not confirm this email address.",
  oauth_state: "The sign-in attempt expired. Try again.",
  oauth_failed: "Google sign-in failed. Try again.",
  demo_disabled: "DEMO sign-in is disabled in LIVE mode.",
  bad_code: "Wrong demo access code.",
  live_only: "Google sign-in is only used in LIVE mode.",
};

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense fallback={null}>
        <LoginCard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginCard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection(); // configuration is read at request time, never baked into the build
  const cfg = getConfig();
  if (!cfg.ok) redirect("/setup");
  const { error } = await searchParams;
  return (
    <div className="w-full max-w-sm rounded-[20px] bg-panel p-7">
      <h1 className="text-2xl font-semibold tracking-tight">Valemont OS</h1>
      <p className="mt-1 text-sm text-text-2">Founders only.</p>
      {error ? <p role="alert" className="mt-4 rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad">{ERRORS[error] ?? "Sign-in failed."}</p> : null}
      {cfg.mode === "live" ? (
        <a href="/api/auth/google" className="mt-6 flex h-12 items-center justify-center rounded-full bg-accent font-medium text-on-accent hover:bg-accent-hover">
          Sign in with Google
        </a>
      ) : (
        <form action="/api/auth/demo" method="post" className="mt-6 flex flex-col gap-3">
          <p className="rounded-[12px] bg-ink p-3 text-[13px] font-medium text-panel">DEMO mode · synthetic data only. Connect Google credentials to use LIVE mode.</p>
          {cfg.demo.accessCode ? (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text-2">
              Demo access code
              <input name="code" type="password" required className="h-10 rounded-[12px] border border-control bg-panel px-3 text-ink" />
            </label>
          ) : null}
          <button name="founder" value="theo" className="h-12 rounded-full bg-accent font-medium text-on-accent hover:bg-accent-hover">Continue as Théo (demo)</button>
          <button name="founder" value="pablo" className="h-12 rounded-full border border-control font-medium hover:bg-subtle">Continue as Pablo (demo)</button>
        </form>
      )}
    </div>
  );
}
