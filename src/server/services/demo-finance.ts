import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import { addDays, localDate } from "@/domain/time";
import type { AppContext } from "../context";
import { contractsFromProjects } from "./finance";

/**
 * Stage 3 DEMO data (D078): contracts and revenue schedule from the demo projects, and two manual EUR entries (a 30/30
 * sale outside Wise and an API invoice) so every P&L line has something. Everything is EUR (D082).
 */
export async function seedDemoFinance(repo: DataRepository) {
  const today = localDate(new Date(), "Europe/Paris");
  const sys = { founder: "system" };
  await contractsFromProjects({ repo } as AppContext, "system");
  const apiDate = addDays(today, -10);
  await repo.insert("LedgerEntries", [
    {
      id: childId("demo-ledger", "thirty"), date: addDays(today, -4), kind: "income", category: "revenue", cost_center: "thirty", cost_class: "", currency: "EUR", amount_minor: 3900, vat_minor: 0,
      fx_rate: "", fx_date: null, fx_source: "", eur_minor: 3900, eur_vat_minor: 0, counterparty: "Acheteur 30/30 (démo)", reference: "3030-DEMO-1", receipt_url: "", project_id: "", contract_id: "",
      service_from: null, service_to: null, corrects_id: "", note: "Rapport 30/30 (démo)",
    },
    {
      id: childId("demo-ledger", "api"), date: apiDate, kind: "expense", category: "api_tokens", cost_center: "local", cost_class: "direct", currency: "EUR", amount_minor: -2200, vat_minor: 0,
      fx_rate: "", fx_date: null, fx_source: "", eur_minor: -2200, eur_vat_minor: 0, counterparty: "Fournisseur exemple (démo)",
      reference: "INV-DEMO-1", receipt_url: "https://files.example.com/recu-demo.pdf", project_id: "", contract_id: "", service_from: null, service_to: null, corrects_id: "", note: "Jetons d'API (démo)",
    },
  ], sys);
}
