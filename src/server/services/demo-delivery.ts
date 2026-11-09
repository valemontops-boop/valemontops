import type { DataRepository } from "@/data/repository";
import { addDays, localDate } from "@/domain/time";
import { childId } from "@/lib/ids";
import type { AppContext } from "../context";
import { wonToProject } from "./delivery";
import { usageId } from "./local-subscriptions";

/**
 * DEMO only (D075): two fictional won deals turned into clients and projects through the real workflow, one fictional
 * contractor, one tool, one internal template and a month of Local usage. Invented names, example.com addresses.
 */
export async function seedDemoDelivery(repo: DataRepository) {
  if (await repo.get("Vendors", childId("demo-vendor", "0"))) return;
  const sys = { founder: "system" };
  const today = localDate(new Date(), "Europe/Paris");
  const ctx: AppContext = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };

  const accounts = [
    { i: 3, name: "Toitures Leroy (demo)", brand: "consulting" as const, market: "FR" as const, owner: "theo" as const, value: 150000, start: addDays(today, -20) },
    { i: 6, name: "Electricidad Vega (demo)", brand: "local" as const, market: "ES" as const, owner: "pablo" as const, value: 10000, start: addDays(today, -40) },
  ];
  for (const a of accounts) {
    const id = childId("demo-won-opp", String(a.i));
    await repo.insert("Opportunities", [{
      id, account_id: childId("demo-account", String(a.i)), primary_contact_id: childId("demo-contact", String(a.i)), name: a.name.replace(" (demo)", ""), brand: a.brand, market: a.market,
      stage: "won", owner_founder: a.owner, value_minor: a.value, currency: "EUR", expected_close: null, next_action: a.market === "FR" ? "Suivre le projet" : "Seguir el proyecto", next_action_due: addDays(today, 7), next_action_priority: "normal", next_action_reason: "",
      lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
    }], sys);
    await wonToProject(ctx, a.owner, {
      opportunity_id: id, start_date: a.start, owner_founder: a.owner,
      promised: a.brand === "consulting" ? "Diagnostic des appels manqués et relance automatique des devis (démo)." : "Captura de solicitudes y aviso al dueño (demo).",
      stakeholders: a.brand === "consulting" ? "Gérant, secrétaire (démo)" : "Dueño (demo)",
      success: a.brand === "consulting" ? "Moins de 5 appels manqués par semaine (démo)" : "Cada solicitud respondida en menos de 1 h (demo)",
    });
  }

  await repo.insert("Vendors", [{
    id: childId("demo-vendor", "0"), name: "Camille Exemple (demo)", company: "Studio Exemple (demo)", skills: ["automatisation", "no-code", "intégration CRM"], services: "Intégrations et automatisations",
    timezone: "Europe/Paris", country: "FR", currency: "EUR", hourly_rate_minor: 4500, daily_rate_minor: null, fixed_rate_minor: null, capacity_hours_week: 10, availability: "available",
    response_sla_hours: 24, nda_status: "signed", contract_status: "draft", rate_valid_until: addDays(today, 90), contact_email: "camille@studio-exemple.example.com", contact_phone: "",
    notes: "Fiche de démonstration.", quality_feedback: "",
  }, {
    id: childId("demo-vendor", "1"), name: "Lucía Ejemplo (demo)", company: "", skills: ["traducción", "contenidos"], services: "Traducción FR/ES",
    timezone: "Europe/Madrid", country: "ES", currency: "EUR", hourly_rate_minor: 3000, daily_rate_minor: null, fixed_rate_minor: null, capacity_hours_week: 15, availability: "limited",
    response_sla_hours: 48, nda_status: "none", contract_status: "none", rate_valid_until: null, contact_email: "lucia@ejemplo.example.com", contact_phone: "", notes: "Ficha de demostración.", quality_feedback: "",
  }], sys);

  const runFr = childId("workflow", "won_to_project", childId("demo-won-opp", "3"));
  const projectFr = childId(runFr, "project");
  await repo.insert("ProjectAssignments", [{ id: childId("demo-assign", "0"), project_id: projectFr, vendor_id: childId("demo-vendor", "0"), role: "Automatisations", rate_minor: 4500, rate_unit: "hour", currency: "EUR", planned_hours: 16, start_date: addDays(today, -14), end_date: addDays(today, 13), status: "active", note: "" }], sys);
  await repo.insert("TimeEntries", [
    { id: childId("demo-time", "0"), project_id: projectFr, person_kind: "founder", founder_key: "theo", vendor_id: "", date: addDays(today, -18), minutes: 240, note: "Kick-off" },
    { id: childId("demo-time", "1"), project_id: projectFr, person_kind: "founder", founder_key: "theo", vendor_id: "", date: addDays(today, -9), minutes: 180, note: "" },
    { id: childId("demo-time", "2"), project_id: projectFr, person_kind: "contractor", founder_key: null, vendor_id: childId("demo-vendor", "0"), date: addDays(today, -5), minutes: 300, note: "" },
  ], sys);
  await repo.insert("ProjectCosts", [{ id: childId("demo-cost", "0"), project_id: projectFr, date: addDays(today, -6), kind: "api", label: "Appels API (démo)", amount_minor: 1800, currency: "EUR", tool_id: childId("demo-tool", "0") }], sys);
  const kickFr = (await repo.list("Milestones")).rows.find((m) => m.project_id === projectFr && m.sort === 0);
  if (kickFr) await repo.update("Milestones", kickFr.id, kickFr.version, { done_at: new Date(Date.parse(`${addDays(today, -17)}T10:00:00Z`)).toISOString() }, sys);
  const pFr = await repo.get("Projects", projectFr);
  if (pFr) await repo.update("Projects", pFr.id, pFr.version, { status: "in_progress", checklist: pFr.checklist.map((c, n) => ({ ...c, done: n < 2 })) }, sys);
  await repo.insert("Tasks", [{
    id: childId("demo-project-task", "0"), title: "Préparer l'accès au standard téléphonique", description: "", owner: null, created_by_founder: "theo", account_id: "", opportunity_id: "", project_id: projectFr,
    client_id: childId("client", childId("demo-account", "3")), priority: "P2", status: "todo", estimated_minutes: null, due_at: addDays(today, 2), recurrence: "none", recurrence_parent_id: "", dependency_ids: [],
    completion_evidence: "", completed_at: null, visibility: "team", snoozed_until: null, snooze_reason: "", area: "ops", source: "manual", source_id: "",
  }], sys);

  const runEs = childId("workflow", "won_to_project", childId("demo-won-opp", "6"));
  const pEs = await repo.get("Projects", childId(runEs, "project"));
  if (pEs) await repo.update("Projects", pEs.id, pEs.version, { status: "delivered", checklist: pEs.checklist.map((c) => ({ ...c, done: true })) }, sys);
  for (const m of (await repo.list("Milestones")).rows.filter((x) => x.project_id === pEs?.id && x.due_date && x.due_date < today)) await repo.update("Milestones", m.id, m.version, { done_at: `${m.due_date}T16:00:00.000Z` }, sys);
  const clientEs = childId("client", childId("demo-account", "6"));
  const c = await repo.get("Clients", clientEs);
  if (c) await repo.update("Clients", c.id, c.version, { status: "active" }, sys);
  const month = today.slice(0, 7);
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  await repo.insert("LocalSubscriptionUsage", [
    { id: usageId(clientEs, month), client_id: clientEs, month, conversations: 172, qualified_requests: 41, automated_emails: 96, support_minutes: 48, locations: 1, actual_cost_minor: null, source: "manual", note: "" },
    { id: usageId(clientEs, prev), client_id: clientEs, month: prev, conversations: 131, qualified_requests: 30, automated_emails: 70, support_minutes: 25, locations: 1, actual_cost_minor: null, source: "import", note: "" },
  ], sys);

  await repo.insert("ToolCosts", [{
    id: childId("demo-tool", "0"), name: "API de modèle de langage (démo)", provider: "Fournisseur exemple (démo)", use_case: "Qualification des demandes", apis: "REST", integration_status: "live",
    monthly_cost_minor: 2000, currency: "EUR", usage_limits: "Plafond mensuel 20 €", pricing_version: "Tarif public (démo)", pricing_date: addDays(today, -30), owner_founder: "theo", environment: "production",
    linked_project_ids: [projectFr], risk_notes: "Pas de données de santé ; journalisation désactivée (démo).", expense_category: "software",
  }], sys);
  await repo.insert("AgentTemplates", [{
    id: childId("demo-agent", "0"), name: "Relance de devis (démo)", kind: "workflow", purpose: "Relancer un devis sans réponse à J+3 et J+7, puis prévenir le gérant.", stack: "Formulaire + e-mail",
    inputs: "Devis envoyé", outputs: "E-mails de relance, alerte", linked_tool_ids: [childId("demo-tool", "0")], linked_project_ids: [projectFr], owner_founder: "theo", status: "tested", notes: "",
  }], sys);
}
