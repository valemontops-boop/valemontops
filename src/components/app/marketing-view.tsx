"use client";
import * as React from "react";
import { useT } from "@/i18n/react";
import { SegmentedSwitch } from "@/components/ui/form";
import { ExportButton } from "./export-dialog";
import { GrowthDashboard } from "./growth-dashboard";
import type { Days, Scope } from "./growth-common";

export { AudienceSummary } from "./marketing-social";

/**
 * Growth (iteration 10, D077): ONE dashboard. Period + scope + export → ≤ 5 key numbers → every channel compared in one
 * visual (views: volume, results, cost) → what the numbers say. A channel (or a number) opens its details in a drawer
 * (?channel=web&view=cost&tab=seo), where its funnel, its cost and its data entry live.
 */
export function MarketingView() {
  const t = useT();
  const [days, setDays] = React.useState<Days>("30");
  const [scope, setScope] = React.useState<Scope>("team");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Growth")}</h1>
          <p className="text-sm text-text-2">{t("Which channel brings meetings, for how much work.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedSwitch size="sm" label={t("Period")} value={days} onChange={setDays} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} />
          <SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Me") }]} />
          <ExportButton />
        </div>
      </div>
      <GrowthDashboard filter={{ days, scope }} />
    </div>
  );
}
