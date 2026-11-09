import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import { addDays, localDate } from "@/domain/time";
import { toEur } from "@/domain/fx";
import type { AppContext } from "../context";
import { contractsFromProjects } from "./finance";

/** Labelled DEMO rate (scenario 9 fixture), never presented as an ECB rate. */
export const DEMO_USD_RATE = "1.1000";

/**
 * Stage 3 DEMO data (D078): weekly demo EUR/USD rates (source "demo"), contracts and revenue schedule from the demo
 * projects, and two manual entries (a 30/30 sale outside Wise and a USD API invoice) so every P&L line has something.
 */
export async function seedDemoFinance(repo: DataRepository) {
  const today = localDate(new Date(), "Europe/Paris");
  const sys = { founder: "system" };
  const now = new Date().toISOString();
  const days = [today, ...Array.from({ length: 60 }, (_, i) => addDays(today, -7 * (i + 1)))];
  await repo.insert("FxRates", days.map((d) => ({ id: childId("fx", "demo", "USD", d), base: "EUR", quote: "USD", rate: DEMO_USD_RATE, rate_date: d, source: "demo" as const, fetched_at: now })), sys);
  await contractsFromProjects({ repo } as AppContext, "system");
  const usdDate = addDays(today, -10);
  await repo.insert("LedgerEntries", [
    {
      id: childId("demo-ledger", "thirty"), date: addDays(today, -4), kind: "income", category: "revenue", cost_center: "thirty", cost_class: "", currency: "EUR", amount_minor: 3900, vat_minor: 0,
      fx_rate: "", fx_date: null, fx_source: "", eur_minor: 3900, eur_vat_minor: 0, counterparty: "Acheteur 30/30 (démo)", reference: "3030-DEMO-1", receipt_url: "", project_id: "", contract_id: "",
      service_from: null, service_to: null, corrects_id: "", note: "Rapport 30/30 (démo)",
    },
    {
      id: childId("demo-ledger", "api-usd"), date: usdDate, kind: "expense", category: "api_tokens", cost_center: "local", cost_class: "direct", currency: "USD", amount_minor: -2400, vat_minor: 0,
      fx_rate: DEMO_USD_RATE, fx_date: usdDate, fx_source: "demo", eur_minor: -toEur(2400, "USD", { rate: DEMO_USD_RATE }), eur_vat_minor: 0, counterparty: "Fournisseur exemple (démo)",
      reference: "INV-DEMO-1", receipt_url: "https://files.example.com/recu-demo.pdf", project_id: "", contract_id: "", service_from: null, service_to: null, corrects_id: "", note: "Jetons d'API (démo)",
    },
  ], sys);
}
