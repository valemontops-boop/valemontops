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
    lead_status: "working" as const, observed_problem: i % 2 === 0 ? "Appels manqués : messagerie pleine pendant les chantiers (constaté sur deux appels)." : "",
    problem_evidence: "", language: country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
  }));
  await repo.insert("Accounts", acc, sys);
  await repo.insert(
    "Contacts",
    acc.map((a, i) => ({
      id: childId("demo-contact", String(i)),
      account_id: a.id,
      full_name: ["Alex Demo", "Camille Exemple", "Dominique Test", "Sacha Fictif", "Lucía Ejemplo", "Mario Prueba", "Nora Demo", "Iker Ficticio"][i],
      role: "Gérant", is_decision_maker: true, phone: a.phone, email: a.email, linkedin_url: "",
      contact_type: i === 6 ? ("sole_trader" as const) : ("professional_named" as const),
      language: a.language, consent_status: i === 7 ? ("opted_out" as const) : ("unknown" as const),
      lawful_basis: "Intérêt légitime (B2B, lié à la fonction) — à confirmer", source: "Demo list",
      retention_review_at: null, import_batch_id: "",
    })),
    sys,
  );
  const opps = [
    [0, "contacted", "theo", "Rappeler après 17 h", addDays(today, 0), 49000],
    [1, "discovery_scheduled", "theo", "Visite de découverte", addDays(today, 2), 49000],
    [2, "targeted", "theo", "", null, null],
    [4, "replied", "pablo", "Enviar el vídeo de demo", addDays(today, -1), 49000],
    [5, "contacted", "pablo", "Llamada de seguimiento", addDays(today, 1), 49000],
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
    id: childId("demo-sprint", "1"), name: "Sprint lancement Local (démo)", start_date: addDays(today, -6), end_date: addDays(today, 7), status: "active",
    niche: "garage", targets: { theo: { contacted: 50, replies: 10, demos: 3, pilots: 1 }, pablo: { contacted: 50, replies: 10, demos: 3, pilots: 1 } },
    brand_split: { local: 0.7, consulting: 0.2, thirty: 0.1 },
  }], sys);
  const task = (i: number, p: Record<string, unknown>) => ({
    id: childId("demo-task", String(i)), title: "", description: "", owner: null, created_by_founder: "theo", account_id: "", opportunity_id: "", project_id: "", client_id: "",
    priority: "P2", status: "todo", estimated_minutes: null, due_at: null, recurrence: "none", recurrence_parent_id: "", dependency_ids: [], completion_evidence: "",
    completed_at: null, visibility: "team", snoozed_until: null, snooze_reason: "", source: "manual", source_id: "", ...p,
  });
  await repo.insert("Tasks", [
    task(1, { title: "Écrire et tourner le reel démo Local (FR)", owner: "theo", priority: "P1", due_at: today, estimated_minutes: 60, area: "marketing" }),
    task(2, { title: "Traducir el guion de llamada al español", owner: "pablo", priority: "P0", due_at: today, created_by_founder: "theo", estimated_minutes: 45, area: "sales" }),
    task(3, { title: "Acheter la liste de garages de Lyon", owner: null, priority: "P2", due_at: addDays(today, 2), area: "sales" }),
    task(4, { title: "Nettoyage hebdo du pipeline", owner: "theo", priority: "P2", due_at: addDays(today, -1), recurrence: "weekly", area: "ops" }),
    task(5, { title: "Ouvrir le compte bancaire de la société", owner: "theo", priority: "P1", due_at: today, area: "ops" }),
    task(6, { title: "Publicar 2 stories de Instagram (ES)", owner: "pablo", priority: "P2", due_at: today, area: "marketing" }),
  ] as never, sys);
  await repo.insert("Ideas", [
    { id: childId("demo-idea", "1"), text: "Proposer un pilote gratuit de 14 jours aux garages", note: "", brand: "local", category: "offer", status: "testing", votes: { theo: "yes" }, reason: "", created_by_founder: "theo", converted_type: null, converted_id: "" },
    { id: childId("demo-idea", "2"), text: "Reel court : les appels manqués coûtent de l'argent", note: "", brand: "local", category: "content", status: "testing", votes: {}, reason: "", created_by_founder: "pablo", converted_type: null, converted_id: "" },
    { id: childId("demo-idea", "3"), text: "Aliarse con una red de gestorías en Madrid", note: "", brand: "consulting", category: "partner", status: "discuss", votes: { pablo: "yes", theo: "maybe" }, reason: "", created_by_founder: "pablo", converted_type: null, converted_id: "" },
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
    { id: childId("demo-content", "1"), idempotency_key: childId("demo-content-key", "1"), founder_key: "theo", deliverable: "reel", brand: "thirty", language: "FR", title: "30/30 : 3 outils IA pour plombiers (FR)", url: "", local_date: today },
    { id: childId("demo-content", "2"), idempotency_key: childId("demo-content-key", "2"), founder_key: "pablo", deliverable: "brand_post", brand: "consulting", language: "ES", title: "Caso: respuesta en 5 minutos", url: "", local_date: today },
  ], sys);
  await seedDemoCallsAndEmails(repo, today);
  return true;
}

/** A past free-dialling session with objections on every kind of outcome, and follow-up emails with replies. */
async function seedDemoCallsAndEmails(repo: DataRepository, today: string) {
  const sys = { founder: "system" };
  await repo.insert("SystemSettings", [
    { id: childId("setting", "calendly_url_theo"), key: "calendly_url_theo", value: "https://calendly.example.com/theo-demo/15min", description: "Théo's booking link inserted in call follow-ups." },
    { id: childId("setting", "calendly_url_pablo"), key: "calendly_url_pablo", value: "https://calendly.example.com/pablo-demo/15min", description: "Pablo's booking link inserted in call follow-ups." },
    { id: childId("setting", "deck_url_fr"), key: "deck_url_fr", value: "https://drive.example.com/file/demo-deck-fr", description: "Commercial deck link (French)." },
    { id: childId("setting", "deck_url_es"), key: "deck_url_es", value: "https://drive.example.com/file/demo-deck-es", description: "Commercial deck link (Spanish)." },
  ], sys);
  // A small call list so call mode can be tried end to end (3 FR for Théo, 3 ES for Pablo).
  const listId = childId("demo-call-list", "1");
  await repo.insert("CallLists", [{ id: listId, name: "Trades & garages (demo)", source: "Demo", market: null, niche: "Building trades", brand: "local", owner_founder: null, notes: "" }], sys);
  const callAcc = ([
    ["Plomberie Martin (demo)", "FR", "Plumbers", "theo", "Julien"], ["Garage Bernard (demo)", "FR", "Independent garages", "theo", "Nadia"], ["Électricité Roux (demo)", "FR", "Electricians", "theo", ""],
    ["Fontanería Gil (demo)", "ES", "Plumbers", "pablo", "Carmen"], ["Taller Navarro (demo)", "ES", "Independent garages", "pablo", "Javier"], ["Reformas Díaz (demo)", "ES", "Renovation", "pablo", ""],
  ] as const).map(([name, country, niche, owner, contact], i) => {
    const domain = `call-demo-${i + 1}.example.com`;
    return { name, contact, a: {
      id: childId("demo-call-account", String(i)), name, sector: "Building trades", niche, country, city: "", website: `https://${domain}`, domain_normalized: domain,
      phone: country === "FR" ? `+3310000020${i}` : `+3490000020${i}`, email: `contact@${domain}`, linkedin_url: "", lead_source: "Demo list", lead_type: "outbound" as const,
      brand: "local" as const, owner_founder: owner, lead_status: "new" as const, observed_problem: "", problem_evidence: "", language: country === "FR" ? "fr" : "es", notes: "", import_batch_id: "", list_id: listId,
    } };
  });
  await repo.insert("Accounts", callAcc.map((x) => x.a), sys);
  await repo.insert("Contacts", callAcc.filter((x) => x.contact).map((x, i) => ({
    id: childId("demo-call-contact", String(i)), account_id: x.a.id, full_name: x.contact, role: "Gérant", is_decision_maker: true, phone: x.a.phone, email: x.a.email, linkedin_url: "",
    contact_type: "professional_named" as const, language: x.a.language, consent_status: "unknown" as const, lawful_basis: "Intérêt légitime (B2B) — à confirmer", source: "Demo list", retention_review_at: null, import_batch_id: "",
  })), sys);
  const day = addDays(today, -2);
  const sid = childId("demo-call-session", "1");
  await repo.insert("CallSessions", [{ id: sid, founder_key: "theo", list_id: "", started_at: `${day}T08:00:00.000Z`, ended_at: `${day}T09:10:00.000Z`, notes: "" }], sys);
  type O = "no_answer" | "gatekeeper" | "not_interested" | "callback_requested" | "interested" | "meeting_booked";
  const plan: [O, string[]][] = [
    ["no_answer", []], ["no_answer", []], ["not_interested", ["no_need"]], ["no_answer", []], ["gatekeeper", ["not_decision_maker"]],
    ["not_interested", ["too_expensive"]], ["interested", ["too_expensive"]], ["no_answer", []], ["not_interested", ["already_has_solution"]],
    ["callback_requested", ["no_time"]], ["meeting_booked", ["send_info"]], ["not_interested", ["no_time"]], ["no_answer", []],
    ["interested", ["send_info", "too_expensive"]], ["not_interested", ["bad_experience"]], ["no_answer", []], ["not_interested", ["send_info"]],
    ["meeting_booked", ["no_time"]], ["not_interested", ["no_need", "too_expensive"]], ["no_answer", []],
  ];
  await repo.insert("ActivityEvents", plan.map(([outcome, objections], i) => {
    const at = new Date(Date.parse(`${day}T08:02:00.000Z`) + i * 3.4 * 60_000).toISOString();
    return {
      id: childId("demo-call-ev", String(i)), idempotency_key: childId("demo-call-key", String(i)), founder_key: "theo" as const,
      activity_type: outcome === "no_answer" ? ("cold_call" as const) : ("connected_call" as const), channel: null, account_id: "", contact_id: "", opportunity_id: "", campaign_id: "",
      brand: "local" as const, market: "FR" as const, outcome, objection: (objections[0] ?? null) as never, objections: objections as never, replies: objections.map((o) => `${o}#${(i % 2) + 1}`), objection_note: "", met_person: "", notes: "",
      next_action: "", next_action_due: null, occurred_at: at, logged_at: at, timezone: "Europe/Paris", local_date: day, late_logged: false, source: "manual" as const,
      corrects_event_id: "", call_session_id: sid, list_id: "", target_key: `demo-target-${i}`, duration_sec: outcome === "no_answer" ? null : 60 + ((i * 37) % 200),
    };
  }), sys);
  // 64 follow-ups over four weeks: warm (after a call) and cold, FR and ES, some replies marked.
  const niches = ["Plumbers", "Independent garages", "Heating", "Electricians"];
  const rows = Array.from({ length: 64 }, (_, i) => {
    const d = addDays(today, -1 - (i % 27));
    const cold = i % 3 === 0;
    const es = i % 4 === 1 || i % 4 === 2;
    const tpl = cold ? "calendly" : (["calendly", "deck", "confirm"] as const)[i % 3];
    // Realistic shape: cold ≈ 4–5% replies, warm (after a call) ≈ 30%, one bounce.
    const reply = cold ? (i === 21 ? "positive" : null) : i === 22 ? "bounce" : i % 7 === 1 ? "positive" : i % 7 === 4 ? "neutral" : i % 13 === 5 ? "negative" : null;
    const at = `${d}T${String(9 + (i % 8)).padStart(2, "0")}:15:00.000Z`;
    return {
      id: childId("demo-send", String(i)), idempotency_key: childId("demo-send-key", String(i)), founder_key: (es ? "pablo" : "theo") as "pablo" | "theo",
      account_id: childId("demo-account", String(es ? 4 + (i % 4) : i % 4)), contact_id: "", activity_event_id: "", call_session_id: "",
      channel: (i % 9 === 4 ? "whatsapp" : "email") as "email" | "whatsapp", via: (i % 9 === 4 ? "whatsapp" : i % 2 ? "gmail" : "mail_app") as "gmail" | "mail_app" | "whatsapp",
      context: (cold ? "cold" : "after_call") as "cold" | "after_call", template_key: tpl, language: (es ? "ES" : "FR") as "ES" | "FR", brand: "local" as const, market: (es ? "ES" : "FR") as "ES" | "FR",
      niche: niches[i % 4], to_address: `contact${i}@business-demo.example.com`, subject: "Relance (démo)", status: "sent" as const, sent_at: at, local_date: d,
      gmail_message_id: "", gmail_thread_id: "", replied_at: reply ? at : null, reply_kind: reply as "positive" | "neutral" | "negative" | "bounce" | null,
    };
  });
  await repo.insert("EmailSends", rows, sys);
}

/** Browser preview only: three calls in the last hour, so "Messages to send" has something to show. Not in DEMO (tests start from a clean day). */
export async function seedPreviewRecentCalls(repo: DataRepository) {
  const sys = { founder: "system" };
  const recent: [number, "connected_call" | "cold_call", "interested" | "not_interested" | "no_answer", string[]][] = [[0, "connected_call", "interested", ["send_info"]], [2, "connected_call", "not_interested", ["enough_work"]], [3, "cold_call", "no_answer", []]];
  await repo.insert("ActivityEvents", recent.map(([acc, type, outcome, objections], i) => {
    const at = new Date(Date.now() - (50 - i * 10) * 60_000).toISOString();
    return {
      id: childId("demo-recent-ev", String(i)), idempotency_key: childId("demo-recent-key", String(i)), founder_key: "theo" as const, activity_type: type, channel: null,
      account_id: childId("demo-account", String(acc)), contact_id: "", opportunity_id: "", campaign_id: "", brand: "local" as const, market: "FR" as const, outcome,
      objection: (objections[0] ?? null) as never, objections: objections as never, replies: objections.map((o) => `${o}#1`), objection_note: "", met_person: "", notes: "",
      next_action: "", next_action_due: null, occurred_at: at, logged_at: at, timezone: "Europe/Paris", local_date: localDate(new Date(at), "Europe/Paris"), late_logged: false,
      source: "manual" as const, corrects_event_id: "", call_session_id: "", list_id: "", target_key: "", duration_sec: type === "connected_call" ? 140 : null,
    };
  }), sys);
}
