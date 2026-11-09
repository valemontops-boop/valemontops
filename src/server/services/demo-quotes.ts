import { childId } from "@/lib/ids";
import type { DataRepository } from "@/data/repository";

/**
 * DEMO only (never LIVE): fictional legal details, visibly marked DÉMO, so the quote PDF can be tried in the demo.
 * The cross-border rule FR → ES is a demo example for the accountant to confirm, not advice.
 */
export async function seedDemoCommercial(repo: DataRepository) {
  const rows = [
    ["legal_name", "Valemont (DÉMO)"],
    ["legal_form", "SAS (démo)"],
    ["address", "1 rue de l'Exemple, 75000 Paris (démo)"],
    ["seller_country", "FR"],
    ["company_id", "000 000 000 (démo)"],
    ["vat_number", "FR00 000000000 (démo)"],
    ["legal_mentions", "Document de démonstration : données fictives."],
    ["tax_rules", JSON.stringify([
      { seller: "FR", client: "FR", label: "TVA", rate_bp: 2000, mention: "" },
      { seller: "ES", client: "ES", label: "IVA", rate_bp: 2100, mention: "" },
      { seller: "FR", client: "ES", label: "IVA", rate_bp: 0, mention: "DÉMO : autoliquidation (inversión del sujeto pasivo), à confirmer par votre comptable." },
    ])],
  ] as const;
  const have = new Set((await repo.list("CommercialPolicy", { fresh: true })).rows.map((r) => r.id));
  const add = rows.map(([key, value]) => ({ id: childId("demo-policy", key), key, value, effective_from: "2000-01-02", changed_by: "system", note: "demo" })).filter((r) => !have.has(r.id));
  if (add.length) await repo.insert("CommercialPolicy", add, { founder: "system" });
}
