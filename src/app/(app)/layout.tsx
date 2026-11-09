import { Suspense } from "react";
import { AppShell } from "@/components/app/shell";
import { FOUNDER_NAMES } from "@/domain/constants";
import { requireSessionOrRedirect } from "@/server/auth";
import { publicConfig } from "@/server/config";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-2" aria-busy="true">…</div>}>
      <Authed>{children}</Authed>
    </Suspense>
  );
}

async function Authed({ children }: { children: React.ReactNode }) {
  const session = await requireSessionOrRedirect();
  return <AppShell me={{ founder: session.founder, name: FOUNDER_NAMES[session.founder], config: publicConfig() }}>{children}</AppShell>;
}
