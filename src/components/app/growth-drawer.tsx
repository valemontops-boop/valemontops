"use client";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, Panel, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { PANEL_TABS, type GrowthPanel } from "@/domain/growth-dashboard";
import { useT } from "@/i18n/react";
import { formatEur } from "@/lib/utils";
import { EmailQuality, MessagesResults, MessagesWaiting } from "./email-tab";
import { StatStrip, StepFunnel, addCosts, useCostStat, useFunnels, useHours, type FunnelData, type GrowthFilter } from "./growth-common";
import { InboxList } from "./inbox-panel";
import { CallsEconomics } from "./marketing-funnels";
import { TrafficTab, WebVisits } from "./marketing-overview";
import { SeoView } from "./marketing-seo";
import { SocialAccounts } from "./marketing-social";
import { MarketingWeek, TasksFor } from "./my-day-extras";
import { ContentStudioCard } from "./content-studio";

export const PANEL_TITLES: Record<GrowthPanel, string> = {
  calls: "Calls and field visits", messages: "Messages", linkedin: "LinkedIn", social: "Social networks", web: "Web and AI engines", inbox: "To reply", content: "Content",
};
const TAB_LABELS: Record<string, string> = {
  results: "Results", waiting: "Waiting", quality: "Email quality", outreach: "Outreach", accounts: "Accounts", funnel: "Funnel", visits: "Visits", seo: "SEO", add: "Add numbers",
};

/**
 * The detail of one channel (iteration 10, D077): a side drawer on desktop, a full screen sheet on phones. Its cost band, its
 * funnel(s) and its specific data, with the data entry of that channel. Tabs only when the channel has several views.
 */
export function GrowthDrawer({ panel, tab, filter, onTab, onClose }: { panel: GrowthPanel | null; tab: string | null; filter: GrowthFilter; onTab: (tab: string) => void; onClose: () => void }) {
  const t = useT();
  const tabs = panel ? PANEL_TABS[panel] : [];
  return (
    <D.Root open={panel !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content data-growth-drawer
          className="fixed inset-0 z-50 flex flex-col bg-canvas focus:outline-none sm:left-auto sm:w-[min(800px,100vw)] sm:shadow-[0_12px_40px_rgba(23,22,26,0.18)]">
          {panel ? (
            <>
              <div className="flex flex-col gap-3 border-b border-hairline bg-panel px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <D.Title className="text-lg font-semibold tracking-tight">{t(PANEL_TITLES[panel])}</D.Title>
                    <D.Description className="text-[13px] text-text-2">{panel === "inbox" || panel === "content" ? t("Growth") : `${t("{n} days", { n: filter.days })} · ${filter.scope === "team" ? t("Team") : t("Me")}`}</D.Description>
                  </div>
                  <D.Close className="flex size-11 shrink-0 items-center justify-center rounded-full text-text-2 hover:bg-subtle" aria-label={t("Close details")}><X className="size-5" /></D.Close>
                </div>
                {tabs.length && tab ? (
                  <div className="-mx-1 overflow-x-auto px-1 [&_button]:whitespace-nowrap">
                    <SegmentedSwitch size="sm" label={t("View")} value={tab} onChange={onTab} options={tabs.map((k) => ({ value: k, label: t(TAB_LABELS[k]) }))} />
                  </div>
                ) : null}
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
                <PanelBody panel={panel} tab={tab} filter={filter} />
              </div>
            </>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function PanelBody({ panel, tab, filter }: { panel: GrowthPanel; tab: string | null; filter: GrowthFilter }) {
  const t = useT();
  if (panel === "inbox") return <InboxList />;
  if (panel === "content") return <div className="flex flex-col gap-5"><ContentStudioCard /><Panel><MarketingWeek /></Panel><Panel><TasksFor area="marketing" /></Panel></div>;
  if (panel === "web" && tab === "seo") return <SeoView days={filter.days} />;
  if (panel === "web" && tab === "add") return <TrafficTab />;
  if (panel === "messages" && tab === "waiting") return <MessagesWaiting />;
  if (panel === "messages" && tab === "quality") return <EmailQuality />;
  if ((panel === "linkedin" || panel === "social") && tab === "accounts") return <SocialAccounts network={panel === "linkedin" ? "linkedin" : "instagram"} filter={filter} />;
  return (
    <div className="flex flex-col gap-5">
      {panel !== "web" ? <CostBand panel={panel} filter={filter} /> : null}
      {panel === "messages" ? <MessagesResults filter={filter} />
        : panel === "web" ? <WebVisits filter={filter} />
        : <Funnels panel={panel} filter={filter} />}
      {panel === "calls" ? <Button asChild variant="outline" className="self-start"><Link href="/call">{t("Open Call mode")}</Link></Button> : null}
    </div>
  );
}

/** The cost of the channel family: hours of work, total cost, cost per meeting, CAC (D072). */
function CostBand({ panel, filter }: { panel: GrowthPanel; filter: GrowthFilter }) {
  const t = useT();
  const h = useHours();
  const costStat = useCostStat();
  const f = useFunnels(filter);
  if (f.isPending) return <Skeleton className="h-28" />;
  if (f.isError) return <ErrorState error={f.error} onRetry={() => f.refetch()} />;
  const d = f.data;
  const c = d.costs ?? {};
  const cost = panel === "calls" ? addCosts(c.phone, c.field) : panel === "messages" ? addCosts(c.email, c.whatsapp) : panel === "linkedin" ? d.networks?.linkedin ?? c.linkedin
    : panel === "social" ? c.social : addCosts(c.web, c.ai);
  if (!cost) return null;
  const cac = costStat(cost);
  return (
    <StatStrip size="sm" stats={[
      { label: t("Hours of work"), value: h(cost.minutes), note: panel === "linkedin" ? t("outreach and LinkedIn content") : panel === "social" ? t("content pieces and marketing tasks") : panel === "web" ? t("done tasks about the site") : t("actions logged × minutes per action") },
      { label: t("Total cost"), value: formatEur(cost.totalMinor), note: t("time {x} + money {y}", { x: formatEur(cost.timeMinor), y: formatEur(cost.moneyMinor) }) },
      { label: t("Cost per meeting"), value: cost.perMeetingMinor === null ? "—" : formatEur(cost.perMeetingMinor), note: cost.perMeetingMinor === null ? t("no meeting yet") : cost.lowSample ? t("estimate, little data") : t("{n} meetings", { n: cost.meetings }) },
      { ...cac, note: cost.cacMinor === null ? t("no client yet") : cost.lowSample ? t("estimate, little data") : t("{n} clients", { n: cost.won }) },
    ]} />
  );
}

/** Calls, LinkedIn outreach and social networks: their funnel(s) from the same payload as the dashboard. */
function Funnels({ panel, filter }: { panel: GrowthPanel; filter: GrowthFilter }) {
  const t = useT();
  const f = useFunnels(filter);
  if (!f.data) return null;
  const d: FunnelData = f.data;
  const row = (k: string) => [...d.all, ...(d.sources ?? [])].find((c) => c.key === k);
  if (panel === "calls") {
    const phone = row("phone"), field = row("field");
    return (
      <>
        <StepFunnel title={t("Cold calls")} steps={phone?.steps ?? []} hours={phone?.hours} empty={t("No call logged in this period. Open Call mode to start a session.")} />
        {d.calls && d.calls.dials > 0 ? <CallsEconomics d={d} /> : null}
        <StepFunnel title={t("Field visits")} steps={field?.steps ?? []} hours={field?.hours} empty={t("No field visit logged in this period.")} />
      </>
    );
  }
  if (panel === "linkedin") {
    const li = row("linkedin");
    return <StepFunnel title={t("LinkedIn outreach")} steps={li?.steps ?? []} hours={li?.hours} empty={t("No LinkedIn invitation or message logged in this period. Log them with “Log activity”.")} footnote={t("The content of the LinkedIn pages and its website visits are in “Accounts”. The % is the share kept from the step before.")} />;
  }
  const social = row("social");
  return <StepFunnel title={t("Social networks")} steps={social?.steps ?? []} hours={social?.hours} empty={t("No social network numbers in this period: enter or import them in “Accounts”.")} footnote={t("Instagram views and LinkedIn impressions, then the website visits, leads and 30/30 purchases they bring (GA4). The % is the share kept from the step before.")} />;
}
