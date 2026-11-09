export interface NotificationItem {
  key: string; // dedupe key: dismissing hides exactly this occurrence
  kind: "follow_up" | "task" | "integration" | "idea";
  title: string;
  detail: string;
  href: string;
}

/** In-app notifications derived on read (spec 5.11); nothing is sent anywhere. */
export function deriveNotifications(i: {
  founder: string;
  today: string;
  opps: { id: string; account_id: string; owner_founder: string | null; next_action: string; next_action_due: string | null; stage: string; is_archived: boolean }[];
  accountName: Map<string, string>;
  tasks: { id: string; title: string; owner: string | null; status: string; due_at: string | null; priority: string }[];
  integrations: { integration: string; status: string; last_error: string }[];
  dismissed: Set<string>;
}): NotificationItem[] {
  const out: NotificationItem[] = [];
  for (const o of i.opps) {
    if (o.is_archived || ["won", "lost"].includes(o.stage) || o.owner_founder !== i.founder || !o.next_action_due || o.next_action_due >= i.today) continue;
    out.push({ key: `fu:${o.id}:${o.next_action_due}`, kind: "follow_up", title: `Overdue: ${o.next_action || "follow-up"}`, detail: `${i.accountName.get(o.account_id) ?? "Business"} · due ${o.next_action_due}`, href: `/crm?account=${o.account_id}` });
  }
  for (const t of i.tasks) {
    if (t.owner !== i.founder || !["todo", "in_progress"].includes(t.status) || !t.due_at) continue;
    if (t.due_at < i.today || (t.priority === "P0" && t.due_at === i.today))
      out.push({ key: `task:${t.id}:${t.due_at}`, kind: "task", title: t.due_at < i.today ? `Overdue task: ${t.title}` : `P0 due today: ${t.title}`, detail: `${t.priority} · due ${t.due_at}`, href: "/tasks" });
  }
  for (const s of i.integrations) {
    if (s.status === "error") out.push({ key: `int:${s.integration}:${s.last_error.slice(0, 40)}`, kind: "integration", title: `${s.integration} sync failed`, detail: s.last_error || "See Settings › Diagnostics", href: "/settings" });
  }
  return out.filter((n) => !i.dismissed.has(n.key));
}
