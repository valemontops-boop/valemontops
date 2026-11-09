import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { FOUNDER_NAMES } from "@/domain/constants";
import { requireSessionOrRedirect } from "@/server/auth";
import { getConfig, publicConfig } from "@/server/config";
import { needsInstall } from "@/server/services/install";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-2" aria-busy="true">…</div>}>
      <Authed>{children}</Authed>
    </Suspense>
  );
}

async function Authed({ children }: { children: React.ReactNode }) {
  const session = await requireSessionOrRedirect();
  // D086: LIVE with an unprepared Sheet → the Installation page (one button), instead of errors on every screen.
  if (await needsInstall(getConfig(), session.founder)) redirect("/install");
  return <AppShell me={{ founder: session.founder, name: FOUNDER_NAMES[session.founder], config: publicConfig() }}>{children}</AppShell>;
}
