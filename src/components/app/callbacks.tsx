"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Panel, PanelTitle } from "@/components/ui/form";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDay } from "./bits";

/** A call-back still to make (D080), from GET /api/calls/callbacks. */
export type Callback = { key: string; eventId: string; accountId: string; name: string; phone: string; contact: string; at: string | null; due: string | null; isDue: boolean };

export function useCallbacks(poll = false) {
  return useQuery({ queryKey: ["callbacks"], queryFn: () => api<Callback[]>("/api/calls/callbacks"), refetchInterval: poll ? 60_000 : false });
}

/** "Mon 10 Nov, 09:00" in the founder's language, or the day alone when only a date was kept. */
export function useWhen() {
  const tag = useDateTag();
  return (c: Pick<Callback, "at" | "due">) => (c.at ? fmtDateTime(c.at, undefined, tag) : c.due ? fmtDay(c.due, tag) : "");
}

/** Call-backs to make (My Day, Agenda): soonest first, due ones marked, one tap to the call screen. Nothing when empty. */
export function CallbacksList({ max = 6, className }: { max?: number; className?: string }) {
  const t = useT();
  const q = useCallbacks();
  const when = useWhen();
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <Panel aria-labelledby="callbacks-title" className={className}>
      <PanelTitle action={<Link href="/call" className="flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-2"><PhoneCall className="size-4" /> {t("Open call mode")}</Link>}>
        <span id="callbacks-title">{t("Call-backs")}</span>
      </PanelTitle>
      <ul className="flex flex-col">
        {list.slice(0, max).map((c) => (
          <li key={c.key} className="flex items-center gap-3 border-b border-hairline py-2 last:border-0">
            <span className={cn("num w-36 shrink-0 text-[13px]", c.isDue ? "font-semibold text-ink" : "text-text-2")}>{when(c)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}{c.contact ? <span className="font-normal text-text-2"> · {c.contact}</span> : null}</span>
            {c.isDue ? <span className="shrink-0 rounded-full bg-ink px-2 text-[12px] font-medium text-panel">{t("Now")}</span> : null}
          </li>
        ))}
      </ul>
      {list.length > max ? <p className="mt-2 text-[12px] text-text-3">{t("+{n} more", { n: list.length - max })}</p> : null}
    </Panel>
  );
}

const SHOWN_KEY = "vos-callback-reminded";
const readShown = (): string[] => { try { return JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "[]") as string[]; } catch { return []; } };
const writeShown = (v: string[]) => { try { sessionStorage.setItem(SHOWN_KEY, JSON.stringify(v.slice(-50))); } catch { /* convenience only */ } };

/**
 * Reminder when a call-back's time comes (mounted once in the shell): checks every minute, shows one toast per
 * call-back in this tab (and the browser notification when the founder already allowed them), and refreshes the bell.
 * Call-backs more than 30 minutes late at page load stay in the bell and the lists, without a toast.
 */
export function CallbackReminder() {
  const t = useT();
  const qc = useQueryClient();
  const q = useCallbacks(true);
  const when = useWhen();
  const router = useRouter();
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);
  React.useEffect(() => {
    const now = Date.now();
    const shown = new Set(readShown());
    const due = (q.data ?? []).filter((c) => c.at && Date.parse(c.at) <= now && now - Date.parse(c.at) < 30 * 60_000 && !shown.has(`${c.key}:${c.at}`));
    if (!due.length) return;
    for (const c of due) {
      shown.add(`${c.key}:${c.at}`);
      toast(t("Call back now: {name}", { name: c.name }), { description: when(c), duration: 15_000, action: { label: t("Call"), onClick: () => router.push("/call") } });
      try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(t("Call back now: {name}", { name: c.name }), { body: when(c) }); } catch { /* not available */ }
    }
    writeShown([...shown]);
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [q.data, tick, t, qc, when, router]);
  return null;
}
