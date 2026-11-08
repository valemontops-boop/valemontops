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
      expected_close: null, next_action: next, next_action_due: due, next_action_priority: "normal" as const, lost_reason: "",
      anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
    })),
    sys,
  );
  return true;
}
