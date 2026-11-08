import { childId } from "@/lib/ids";
import type { DataRepository } from "@/data/repository";
import { localDate, addDays } from "@/domain/time";

/**
 * Synthetic DEMO fixtures only: invented names, reserved example.com domains and fictional numbers.
 * Never loaded in LIVE mode.
 */
export async function seedDemo(repo: DataRepository) {
  const existing = await repo.list("Accounts", { fresh: true });
  if (existing.rows.length > 0) return false;
  const sys = { founder: "system" };
  const today = localDate(new Date(), "Europe/Paris");

  await repo.insert(
    "WorkModes",
    [
      { id: childId("demo-mode", "theo"), founder_key: "theo", mode: "JOB_SEARCHING", effective_from: "2000-01-01", reason: "Demo" },
      { id: childId("demo-mode", "pablo"), founder_key: "pablo", mode: "EMPLOYED_35H", effective_from: "2000-01-01", reason: "Demo" },
    ],
    sys,
  );

  const accounts = [
    ["Plomberie Duval (demo)", "FR", "Building trades", "Plumbers", "plomberie-duval.example.com", "+33100000001", "theo"],
    ["Chauffage Morel (demo)", "FR", "Building trades", "Heating", "chauffage-morel.example.com", "+33100000002", "theo"],
    ["Garage du Parc (demo)", "FR", "Automotive", "Independent garages", "garage-du-parc.example.com", "+33100000003", "theo"],
    ["Toitures Leroy (demo)", "FR", "Building trades", "Roofers", "toitures-leroy.example.com", "+33100000004", "theo"],
    ["Fontanería Ruiz (demo)", "ES", "Building trades", "Plumbers", "fontaneria-ruiz.example.com", "+34900000001", "pablo"],
    ["Taller Sánchez (demo)", "ES", "Automotive", "Independent garages", "taller-sanchez.example.com", "+34900000002", "pablo"],
    ["Electricidad Vega (demo)", "ES", "Building trades", "Electricians", "electricidad-vega.example.com", "+34900000003", "pablo"],
    ["Climatización Ortega (demo)", "ES", "Building trades", "HVAC", "climatizacion-ortega.example.com", "+34900000004", "pablo"],
  ] as const;
  const acc = accounts.map(([name, country, sector, niche, domain, phone, owner], i) => ({
    id: childId("demo-account", String(i)),
    name, sector, niche, country, city: "", website: `https://${domain}`, domain_normalized: domain, phone, email: `contact@${domain}`,
    linkedin_url: "", lead_source: "Demo list", lead_type: "outbound" as const, brand: "local" as const, owner_founder: owner,
    lead_status: "working" as const, observed_problem: i % 2 === 0 ? "Missed calls go to a full voicemail during site visits (observed on two calls)." : "",
    problem_evidence: "", language: country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
  }));
  await repo.insert("Accounts", acc, sys);
  await repo.insert(
    "Contacts",
    acc.map((a, i) => ({
      id: childId("demo-contact", String(i)),
      account_id: a.id,
      full_name: ["Alex Demo", "Camille Exemple", "Dominique Test", "Sacha Fictif", "Lucía Ejemplo", "Mario Prueba", "Nora Demo", "Iker Ficticio"][i],
      role: "Owner", is_decision_maker: true, phone: a.phone, email: a.email, linkedin_url: "",
      contact_type: i === 6 ? ("sole_trader" as const) : ("professional_named" as const),
      language: a.language, consent_status: i === 7 ? ("opted_out" as const) : ("unknown" as const),
      lawful_basis: "Legitimate interest (B2B, relevant to role) — to be confirmed", source: "Demo list",
      retention_review_at: null, import_batch_id: "",
    })),
    sys,
  );
  const opps = [
    [0, "contacted", "theo", "Call back after 5pm", addDays(today, 0), 49000],
    [1, "discovery_scheduled", "theo", "Discovery visit", addDays(today, 2), 49000],
    [2, "targeted", "theo", "", null, null],
    [4, "replied", "pablo", "Send demo video", addDays(today, -1), 49000],
    [5, "contacted", "pablo", "Follow-up call", addDays(today, 1), 49000],
  ] as const;
  await repo.insert(
    "Opportunities",
    opps.map(([i, stage, owner, next, due, value]) => ({
      id: childId("demo-opp", String(i)),
      account_id: acc[i].id, primary_contact_id: childId("demo-contact", String(i)), name: `${acc[i].name.replace(" (demo)", "")} · Local Essential`,
      brand: "local" as const, market: acc[i].country, stage, owner_founder: owner, value_minor: value, currency: "EUR",
      expected_close: null, next_action: next, next_action_due: due, next_action_priority: "normal" as const, next_action_reason: "", lost_reason: "",
      anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
    })),
    sys,
  );
  return true;
}

/** Stage 1B synthetic DEMO data: calendar sources, Drive folder, sprint, tasks, ideas, audience, private jobs. */
export async function seedDemoWork(repo: DataRepository, privateRepo: (f: string) => DataRepository | null) {
  const { DEMO_IDS } = await import("./demo-google");
  const sys = { founder: "system" };
  const existing = await repo.list("CalendarSources", { fresh: true });
  if (existing.rows.length > 0) return false;
  const today = localDate(new Date(), "Europe/Paris");
  await repo.insert("CalendarSources", [
    { id: childId("demo-cal", "shared"), calendar_id: DEMO_IDS.shared, label: "Valemont (shared)", kind: "shared", owner_founder: null, access: "details" },
    { id: childId("demo-cal", "theo"), calendar_id: DEMO_IDS.theo, label: "Théo personal", kind: "personal", owner_founder: "theo", access: "details" },
    { id: childId("demo-cal", "pablo"), calendar_id: DEMO_IDS.pablo, label: "Pablo personal", kind: "personal", owner_founder: "pablo", access: "details" },
  ], sys);
  await repo.insert("SystemSettings", [
    { id: childId("setting", "drive_folder_id"), key: "drive_folder_id", value: DEMO_IDS.folder, description: "Drive folder shared with the service account (Viewer)." },
    { id: childId("setting", "ideas_testing_limit"), key: "ideas_testing_limit", value: "2", description: "Max ideas in Testing while a sprint is active." },
    { id: childId("setting", "founder_point_video_link"), key: "founder_point_video_link", value: "", description: "Standing video link inserted in founder point events." },
  ], sys);
  await repo.insert("Sprints", [{
    id: childId("demo-sprint", "1"), name: "Local launch sprint (demo)", start_date: addDays(today, -6), end_date: addDays(today, 7), status: "active",
    niche: "garage", targets: { theo: { contacted: 50, replies: 10, demos: 3, pilots: 1 }, pablo: { contacted: 50, replies: 10, demos: 3, pilots: 1 } },
    brand_split: { local: 0.7, consulting: 0.2, thirty: 0.1 },
  }], sys);
  const task = (i: number, p: Record<string, unknown>) => ({
    id: childId("demo-task", String(i)), title: "", description: "", owner: null, created_by_founder: "theo", account_id: "", opportunity_id: "", project_id: "", client_id: "",
    priority: "P2", status: "todo", estimated_minutes: null, due_at: null, recurrence: "none", recurrence_parent_id: "", dependency_ids: [], completion_evidence: "",
    completed_at: null, visibility: "team", snoozed_until: null, snooze_reason: "", source: "manual", source_id: "", ...p,
  });
  await repo.insert("Tasks", [
    task(1, { title: "Script and record the Local demo reel (FR)", owner: "theo", priority: "P1", due_at: today, estimated_minutes: 60, area: "marketing" }),
    task(2, { title: "Translate the call script to Spanish", owner: "pablo", priority: "P0", due_at: today, created_by_founder: "theo", estimated_minutes: 45, area: "sales" }),
    task(3, { title: "Buy the garage prospect list for Lyon", owner: null, priority: "P2", due_at: addDays(today, 2), area: "sales" }),
    task(4, { title: "Weekly pipeline cleanup", owner: "theo", priority: "P2", due_at: addDays(today, -1), recurrence: "weekly", area: "ops" }),
    task(5, { title: "Set up the business bank account", owner: "theo", priority: "P1", due_at: today, area: "ops" }),
    task(6, { title: "Post 2 Instagram stories (ES)", owner: "pablo", priority: "P2", due_at: today, area: "marketing" }),
  ] as never, sys);
  await repo.insert("Ideas", [
    { id: childId("demo-idea", "1"), text: "Offer a 14-day free pilot to garages", note: "", brand: "local", category: "offer", status: "testing", votes: { theo: "yes" }, reason: "", created_by_founder: "theo", converted_type: null, converted_id: "" },
    { id: childId("demo-idea", "2"), text: "Short reel: missed calls cost money", note: "", brand: "local", category: "content", status: "testing", votes: {}, reason: "", created_by_founder: "pablo", converted_type: null, converted_id: "" },
    { id: childId("demo-idea", "3"), text: "Partner with an accountant network in Madrid", note: "", brand: "consulting", category: "partner", status: "discuss", votes: { pablo: "yes", theo: "maybe" }, reason: "", created_by_founder: "pablo", converted_type: null, converted_id: "" },
  ] as never, sys);
  const accId = childId("demo-social", "li-page-valemont");
  const igId = childId("demo-social", "ig-thirty");
  const personal = childId("demo-social", "li-theo");
  await repo.insert("SocialAccounts", [
    { id: accId, platform: "linkedin_page", handle: "Valemont (demo page)", brand: "consulting", market: null, owner_founder: null, connection_mode: "import", visibility: "team" },
    { id: igId, platform: "instagram", handle: "@thirtythirty.demo", brand: "thirty", market: "FR", owner_founder: null, connection_mode: "manual", visibility: "team" },
    { id: personal, platform: "linkedin_personal", handle: "Théo (personal, demo)", brand: null, market: null, owner_founder: "theo", connection_mode: "import", visibility: "owner" },
  ] as never, sys);
  const rows = [];
  for (let d = -20; d <= -1; d++) {
    if (d === -9 || d === -8) continue; // a visible gap: missed captures are never interpolated
    const date = addDays(today, d);
    const k = d + 21;
    rows.push({ id: childId("demo-daily", accId, date), account_id: accId, date, followers: 300 + k * 3, views: null, impressions: 150 + ((k * 37) % 120), reach: 90 + ((k * 23) % 70), profile_visits: 10 + (k % 7), interactions: 6 + (k % 9), link_clicks: 2 + (k % 4), source: "import", captured_at: new Date().toISOString(), import_file: "demo.xls" });
    rows.push({ id: childId("demo-daily", igId, date), account_id: igId, date, followers: 120 + k * 2, views: 400 + ((k * 91) % 600), impressions: null, reach: 200 + ((k * 41) % 200), profile_visits: 15 + (k % 10), interactions: 20 + (k % 15), link_clicks: 1 + (k % 3), source: "manual", captured_at: new Date().toISOString(), import_file: "" });
    rows.push({ id: childId("demo-daily", personal, date), account_id: personal, date, followers: 800 + k * 5, views: null, impressions: 500 + ((k * 53) % 400), reach: null, profile_visits: null, interactions: 30 + (k % 20), link_clicks: null, source: "import", captured_at: new Date().toISOString(), import_file: "demo.xlsx" });
  }
  await repo.insert("SocialAccountDaily", rows as never, sys);
  void privateRepo;
  // Synthetic website traffic and audience countries so the Marketing overview has something to show.
  const traffic = [];
  const srcs = [["instagram", "social", "thirty", 22, 0.06], ["linkedin.com", "referral", "consulting", 9, 0.03], ["google", "organic", "thirty", 7, 0], ["(direct)", "(none)", "consulting", 5, 0.08]] as const;
  for (let d = -20; d <= -1; d++) {
    const date = addDays(today, d);
    for (const [src, med, brand, base, rate] of srcs) {
      for (const [country, share] of [["France", 0.6], ["Spain", 0.15], ["Belgium", 0.25]] as const) {
        const sessions = Math.round(base * share * (1 + ((d * 7 + base) % 5) / 10));
        if (!sessions) continue;
        traffic.push({ id: childId("demo-traffic", date, src, country), date, brand, source: src, medium: med, campaign: "", country, sessions, leads: brand === "consulting" && rate > 0 && country === "France" && (d + base) % 3 === 0 ? 1 : 0, meetings: null, purchases: brand === "thirty" ? Math.round(sessions * rate) : 0, revenue_minor: null, origin: "import" as const, import_file: "demo-ga4.csv" });
      }
    }
  }
  await repo.insert("TrafficDaily", traffic as never, sys);
  await repo.insert("AudienceBreakdown", [["FR", 4800], ["BE", 1800], ["ES", 900], ["MA", 800], ["CH", 700], ["CA", 1000]].map(([key, value]) => ({ id: childId("demo-bd", igId, String(key)), account_id: igId, date: addDays(today, -1), dimension: "country" as const, key: String(key), value: Number(value), unit: "bp" as const, source: "manual" as const })), sys);
  await repo.insert("AudienceBreakdown", [["FR", 210], ["ES", 64], ["BE", 22], ["CH", 9]].map(([key, value]) => ({ id: childId("demo-bd", accId, String(key)), account_id: accId, date: addDays(today, -2), dimension: "country" as const, key: String(key), value: Number(value), unit: "count" as const, source: "import" as const })), sys);
  await repo.insert("ContentLog", [
    { id: childId("demo-content", "1"), idempotency_key: childId("demo-content-key", "1"), founder_key: "theo", deliverable: "reel", brand: "thirty", language: "FR", title: "30/30: 3 AI tools for plumbers (FR)", url: "", local_date: today },
    { id: childId("demo-content", "2"), idempotency_key: childId("demo-content-key", "2"), founder_key: "pablo", deliverable: "brand_post", brand: "consulting", language: "ES", title: "Caso: respuesta en 5 minutos", url: "", local_date: today },
  ], sys);
  return true;
}
