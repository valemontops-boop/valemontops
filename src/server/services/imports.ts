import { z } from "zod";
import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { previewImport, toCsv, type ExistingKeys } from "@/domain/csv";
import { normalizeDomain, normalizeEmail, normalizePhone } from "@/domain/normalize";

async function existingKeys(repo: DataRepository): Promise<ExistingKeys> {
  const t = await repo.listMany(["Accounts", "Contacts"], { fresh: true });
  const keys: ExistingKeys = { domains: new Map(), emails: new Map(), phones: new Map() };
  for (const a of t.Accounts.rows) {
    const d = a.domain_normalized || normalizeDomain(a.website);
    if (d) keys.domains.set(d, a.id);
    if (a.email) keys.emails.set(normalizeEmail(a.email), a.id);
    const p = normalizePhone(a.phone, a.country);
    if (p) keys.phones.set(p, a.id);
  }
  const country = new Map(t.Accounts.rows.map((a) => [a.id, a.country]));
  for (const c of t.Contacts.rows) {
    if (c.email) keys.emails.set(normalizeEmail(c.email), c.account_id);
    const p = normalizePhone(c.phone, country.get(c.account_id));
    if (p) keys.phones.set(p, c.account_id);
  }
  return keys;
}

export const previewSchema = z.object({ csv: z.string().max(1_000_000) });
export async function preview(repo: DataRepository, csv: string) {
  return previewImport(csv, await existingKeys(repo));
}

export const commitSchema = z.object({
  import_id: z.string().uuid(),
  csv: z.string().max(1_000_000),
  brand: z.enum(["consulting", "local", "thirty"]).default("local"),
  owner_founder: z.enum(["theo", "pablo"]).nullable().default(null),
  lead_source: z.string().trim().max(120).default("CSV import"),
  list_name: z.string().trim().max(160).default(""),
});

/**
 * Commits only rows the server itself classifies as new (never trusts the client preview).
 * Ids derive from import_id + row index, so re-submitting the same import adds nothing.
 */
export async function commit(repo: DataRepository, founder: FounderKey, input: z.infer<typeof commitSchema>) {
  const p = await preview(repo, input.csv);
  const t = await repo.listMany(["Accounts", "Contacts"], { fresh: true });
  const have = new Set(t.Accounts.rows.map((a) => a.id));
  const accounts = [];
  const contacts = [];
  for (const r of p.rows) {
    if (r.status !== "new" || !r.data) continue;
    const d = r.data;
    const id = childId(input.import_id, "row", String(r.index));
    if (have.has(id)) continue;
    const country = d.country === "" ? null : d.country;
    accounts.push({
      id, name: d.company, sector: d.sector, niche: d.niche, country, city: d.city, website: d.website,
      domain_normalized: normalizeDomain(d.website) || normalizeDomain(d.email), phone: d.phone, email: d.email,
      linkedin_url: d.contact_name ? "" : d.linkedin_url, lead_source: input.lead_source, lead_type: "outbound" as const,
      brand: input.brand, owner_founder: input.owner_founder, lead_status: "new" as const, observed_problem: "", problem_evidence: "",
      language: d.language || (country === "FR" ? "fr" : country === "ES" ? "es" : ""), notes: d.notes, import_batch_id: input.import_id,
    });
    if (d.contact_name || d.email || d.phone) {
      contacts.push({
        id: childId(id, "contact"), account_id: id, full_name: d.contact_name, role: d.role, is_decision_maker: false,
        phone: d.phone, email: d.email, linkedin_url: d.contact_name ? d.linkedin_url : "",
        contact_type: d.contact_type || (d.contact_name ? ("professional_named" as const) : ("company_generic" as const)),
        language: d.language, consent_status: "unknown" as const, lawful_basis: "", source: input.lead_source,
        retention_review_at: null, import_batch_id: input.import_id,
      });
    }
  }
  // Every import is a call list you can work through in call mode (id = import id, so a retry adds nothing).
  if (accounts.length && !(await repo.get("CallLists", input.import_id, { fresh: true }))) {
    const first = accounts[0];
    await repo.insert("CallLists", [{ id: input.import_id, name: input.list_name || `${input.lead_source} · ${new Date().toISOString().slice(0, 10)}`, source: input.lead_source, market: first.country, niche: first.niche, brand: input.brand, owner_founder: input.owner_founder, notes: "" }], { founder });
  }
  for (const a of accounts) (a as Record<string, unknown>).list_id = input.import_id;
  if (accounts.length) await repo.insert("Accounts", accounts, { founder });
  if (contacts.length) await repo.insert("Contacts", contacts, { founder });
  return { imported: accounts.length, contacts: contacts.length, skipped: p.rows.length - accounts.length };
}

export async function exportAccountsCsv(repo: DataRepository) {
  const t = await repo.listMany(["Accounts", "Contacts"]);
  const first = new Map<string, (typeof t.Contacts.rows)[number]>();
  for (const c of t.Contacts.rows) if (!first.has(c.account_id)) first.set(c.account_id, c);
  return toCsv(
    t.Accounts.rows.filter((a) => !a.is_archived),
    [
      { label: "id", kind: "id", get: (a) => a.id },
      { label: "Company", kind: "text", get: (a) => a.name },
      { label: "Country", kind: "text", get: (a) => a.country },
      { label: "Sector", kind: "text", get: (a) => a.sector },
      { label: "Niche", kind: "text", get: (a) => a.niche },
      { label: "Website", kind: "text", get: (a) => a.website },
      { label: "Phone", kind: "phone", get: (a) => a.phone },
      { label: "Email", kind: "text", get: (a) => a.email },
      { label: "Contact", kind: "text", get: (a) => first.get(a.id)?.full_name },
      { label: "Contact phone", kind: "phone", get: (a) => first.get(a.id)?.phone },
      { label: "Consent", kind: "text", get: (a) => first.get(a.id)?.consent_status },
      { label: "Owner", kind: "text", get: (a) => a.owner_founder },
      { label: "Status", kind: "text", get: (a) => a.lead_status },
      { label: "Notes", kind: "text", get: (a) => a.notes },
    ],
  );
}
