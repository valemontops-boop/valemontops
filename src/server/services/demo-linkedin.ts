import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import { addDays, localDate } from "@/domain/time";

/**
 * DEMO only: a few prospects with a LinkedIn profile (fictitious, example URLs) so the LinkedIn session can be tried:
 * per founder, one invitation sent 8 days ago (check due), one accepted yesterday (first message due), two never contacted.
 * No phone number, so they never enter the call queue. Idempotent by id.
 */
export async function seedDemoLinkedIn(repo: DataRepository) {
  const first = childId("demo-li-account", "0");
  if (await repo.get("Accounts", first, { fresh: true })) return false;
  const sys = { founder: "system" };
  const rows = ([
    ["Menuiserie Lambert (demo)", "Hugo Exemple", "Gérant", "Menuisiers", "Lyon", "FR", "theo", "invited"],
    ["Peinture Blanc (demo)", "Inès Test", "Co-gérante", "Peintres", "Lyon", "FR", "theo", "accepted"],
    ["Paysages Girard (demo)", "Léa Fictive", "Fondatrice", "Paysagistes", "Villeurbanne", "FR", "theo", ""],
    ["Serrurerie Petit (demo)", "Marc Démo", "Artisan serrurier", "Serruriers", "Lyon", "FR", "theo", ""],
    ["Carpintería Molina (demo)", "Lucas Ejemplo", "Gerente", "Carpinteros", "Valencia", "ES", "pablo", "invited"],
    ["Pinturas Herrera (demo)", "Sara Demo", "Socia", "Pintores", "Valencia", "ES", "pablo", "accepted"],
    ["Jardines Romero (demo)", "Elena Prueba", "Fundadora", "Jardineros", "Madrid", "ES", "pablo", ""],
    ["Cerrajería Castro (demo)", "Diego Ficticio", "Autónomo", "Cerrajeros", "Madrid", "ES", "pablo", ""],
  ] as const).map(([name, contact, role, niche, city, country, owner, state], i) => ({ i, name, contact, role, niche, city, country, owner, state, slug: `demo-li-${i + 1}` }));
  await repo.insert("Accounts", rows.map((r) => ({
    id: childId("demo-li-account", String(r.i)), name: r.name, sector: r.country === "FR" ? "Bâtiment" : "Construcción", niche: r.niche, country: r.country, city: r.city, website: "", domain_normalized: "",
    phone: "", email: "", linkedin_url: "", lead_source: "LinkedIn", lead_type: "outbound" as const, brand: "local" as const, owner_founder: r.owner, lead_status: "new" as const,
    observed_problem: "", problem_evidence: "", language: r.country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
  })), sys);
  await repo.insert("Contacts", rows.map((r) => ({
    id: childId("demo-li-contact", String(r.i)), account_id: childId("demo-li-account", String(r.i)), full_name: r.contact, role: r.role, is_decision_maker: true, phone: "", email: "",
    linkedin_url: `https://www.linkedin.com/in/${r.slug}-example`, contact_type: "professional_named" as const, language: r.country === "FR" ? "fr" : "es", consent_status: "unknown" as const,
    lawful_basis: "Intérêt légitime (B2B) — à confirmer", source: "LinkedIn", retention_review_at: null, import_batch_id: "",
  })), sys);
  const today = localDate(new Date(), "Europe/Paris");
  const ev = (r: (typeof rows)[number], type: "linkedin_invitation" | "linkedin_accepted", daysAgo: number, n: number) => {
    const day = addDays(today, -daysAgo);
    const at = `${day}T09:${String(10 + n).padStart(2, "0")}:00.000Z`;
    return {
      id: childId("demo-li-ev", String(r.i), type), idempotency_key: childId("demo-li-key", String(r.i), type), founder_key: r.owner, activity_type: type, channel: "linkedin" as const,
      account_id: childId("demo-li-account", String(r.i)), contact_id: childId("demo-li-contact", String(r.i)), opportunity_id: "", campaign_id: "", brand: "local" as const, market: r.country,
      outcome: type === "linkedin_invitation" ? ("sent" as const) : null, objection: null, objections: [], replies: [], objection_note: "", met_person: "", notes: "",
      next_action: type === "linkedin_invitation" ? "LinkedIn: check if the invitation was accepted" : "LinkedIn: send the first message", next_action_due: type === "linkedin_invitation" ? addDays(day, 7) : day,
      occurred_at: at, logged_at: at, timezone: r.country === "FR" ? "Europe/Paris" : "Europe/Madrid", local_date: day, late_logged: false, source: "manual" as const,
      corrects_event_id: "", call_session_id: "", list_id: "", target_key: "", duration_sec: null,
    };
  };
  await repo.insert("ActivityEvents", rows.flatMap((r) => r.state === "invited" ? [ev(r, "linkedin_invitation", 8, r.i)] : r.state === "accepted" ? [ev(r, "linkedin_invitation", 9, r.i), ev(r, "linkedin_accepted", 1, r.i)] : []), sys);
  return true;
}
