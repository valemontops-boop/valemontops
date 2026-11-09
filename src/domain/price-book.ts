/**
 * Price book seeds (spec 2.5 as overridden by the founders, D068/D071/D073/D074). Every row is a pilot assumption,
 * editable in Settings › Commercial and versioned by effective date. Consulting is the main offer with a
 * founder-entered price (default from `offer_consulting_value_eur`); Local is the entry offer at
 * `offer_local_monthly_eur` per month with no set-up fee by default; the 30/30 AI report is a separate 39 € product.
 */
import type { Brand } from "./constants";
import type { ItemKind, PriceMode, Unit } from "./quotes";

export interface PriceBookSeed {
  item_key: string;
  brand: Brand | null;
  kind: ItemKind;
  name_fr: string;
  name_es: string;
  unit: Unit;
  price_mode: PriceMode;
  one_time_min_minor: number | null;
  one_time_max_minor: number | null;
  monthly_min_minor: number | null;
  monthly_max_minor: number | null;
  /** SystemSettings key whose value (EUR) is the default price, so Settings › Workspace and quotes agree. */
  price_setting_key: string;
  /** Default founder hours: one-off delivery, and per month for recurring service. */
  one_time_hours_x100: number;
  monthly_hours_x100: number;
  /** Direct cost provisions (EUR cents): one-off and per month. */
  one_time_cost_minor: number;
  monthly_cost_minor: number;
  pilot_assumption: boolean;
  limits: string;
  notes: string;
}

const E = (eur: number) => eur * 100;
const seed = (s: Partial<PriceBookSeed> & Pick<PriceBookSeed, "item_key" | "kind" | "name_fr" | "name_es" | "unit" | "price_mode">): PriceBookSeed => ({
  brand: null, one_time_min_minor: null, one_time_max_minor: null, monthly_min_minor: null, monthly_max_minor: null, price_setting_key: "",
  one_time_hours_x100: 0, monthly_hours_x100: 0, one_time_cost_minor: 0, monthly_cost_minor: 0, pilot_assumption: true, limits: "", notes: "", ...s,
});

export const PRICE_BOOK_SEEDS: PriceBookSeed[] = [
  // Consulting: the main offer. Founder-entered prices; no seeded market price.
  seed({ item_key: "consulting_mission", brand: "consulting", kind: "offer", name_fr: "Valemont Consulting · mission", name_es: "Valemont Consulting · misión", unit: "project", price_mode: "founder_entered", price_setting_key: "offer_consulting_value_eur", one_time_hours_x100: 2000, notes: "Main offer. Default price = offer_consulting_value_eur (1 500 € seed)." }),
  seed({ item_key: "consulting_discovery", brand: "consulting", kind: "module", name_fr: "Diagnostic (discovery)", name_es: "Diagnóstico (discovery)", unit: "project", price_mode: "founder_entered", one_time_hours_x100: 600, notes: "Founder-entered." }),
  seed({ item_key: "consulting_module", brand: "consulting", kind: "module", name_fr: "Module de mise en place", name_es: "Módulo de implementación", unit: "project", price_mode: "founder_entered", one_time_hours_x100: 1000, notes: "Founder-entered." }),
  seed({ item_key: "consulting_hours", brand: "consulting", kind: "service", name_fr: "Heures sur mesure", name_es: "Horas a medida", unit: "hour", price_mode: "founder_entered", one_time_hours_x100: 100, notes: "Founder-entered; quantity = hours." }),
  seed({ item_key: "contractor_costs", brand: "consulting", kind: "service", name_fr: "Prestataire externe", name_es: "Proveedor externo", unit: "unit", price_mode: "founder_entered", notes: "Founder-entered; enter the contractor cost as direct cost." }),
  seed({ item_key: "ai_usage_allowance", brand: "consulting", kind: "service", name_fr: "Forfait d'usage IA", name_es: "Bolsa de uso de IA", unit: "month", price_mode: "founder_entered", notes: "Founder-entered, monthly." }),
  seed({ item_key: "maintenance", brand: "consulting", kind: "service", name_fr: "Maintenance continue", name_es: "Mantenimiento continuo", unit: "month", price_mode: "founder_entered", monthly_hours_x100: 100, notes: "Founder-entered, monthly." }),
  // Local: entry offer, 100 €/month, no set-up fee by default (D073). Cost provision 37 €/month (spec 2.5, provisions not actuals).
  seed({
    item_key: "local_essential", brand: "local", kind: "offer", name_fr: "Valemont Local Essentiel", name_es: "Valemont Local Esencial", unit: "month", price_mode: "fixed",
    one_time_min_minor: 0, one_time_max_minor: 0, monthly_min_minor: E(100), monthly_max_minor: E(100), price_setting_key: "offer_local_monthly_eur",
    monthly_cost_minor: E(37), one_time_hours_x100: 200,
    limits: "200 conversations IA, 100 demandes qualifiées, 200 e-mails automatiques / mois, 1 établissement, 30 min de support / mois.",
    notes: "Entry offer (budget too small). Provision 37 €/month: hosting 3, AI 2, email 3, payment fees 4, tools 5, support 20.",
  }),
  seed({ item_key: "addon_whatsapp", brand: "local", kind: "addon", name_fr: "Option : WhatsApp IA connecté", name_es: "Opción: WhatsApp IA conectado", unit: "month", price_mode: "fixed", one_time_min_minor: E(190), one_time_max_minor: E(190), monthly_min_minor: E(59), monthly_max_minor: E(59), notes: "Meta and usage costs billed separately, capped." }),
  seed({ item_key: "addon_email_reactivation", brand: "local", kind: "addon", name_fr: "Option : réactivation clients par e-mail", name_es: "Opción: reactivación de clientes por e-mail", unit: "month", price_mode: "fixed", one_time_min_minor: E(99), one_time_max_minor: E(99), monthly_min_minor: E(39), monthly_max_minor: E(39), notes: "Consent rules apply." }),
  seed({ item_key: "addon_phone_receptionist", brand: "local", kind: "addon", name_fr: "Option : standard téléphonique IA", name_es: "Opción: recepcionista telefónica IA", unit: "month", price_mode: "fixed", one_time_min_minor: E(290), one_time_max_minor: E(290), monthly_min_minor: E(99), monthly_max_minor: E(99), notes: "Minutes billed separately, capped." }),
  seed({ item_key: "addon_volume", brand: "local", kind: "addon", name_fr: "Option : volume supérieur", name_es: "Opción: volumen superior", unit: "month", price_mode: "range", one_time_min_minor: 0, one_time_max_minor: 0, monthly_min_minor: E(29), monthly_max_minor: E(59) }),
  seed({ item_key: "addon_second_location", brand: "local", kind: "addon", name_fr: "Option : deuxième établissement", name_es: "Opción: segundo establecimiento", unit: "location", price_mode: "range", monthly_min_minor: E(49), monthly_max_minor: E(49), notes: "One-off on quote." }),
  seed({ item_key: "addon_integration", brand: "local", kind: "addon", name_fr: "Option : intégration CRM ou logiciel métier", name_es: "Opción: integración CRM o software de gestión", unit: "project", price_mode: "quote" }),
  seed({ item_key: "addon_ads", brand: "local", kind: "addon", name_fr: "Option : gestion publicitaire (Google ou ChatGPT Ads)", name_es: "Opción: gestión de anuncios (Google o ChatGPT Ads)", unit: "month", price_mode: "range", one_time_min_minor: E(249), one_time_max_minor: E(249), monthly_min_minor: E(149), monthly_max_minor: E(249), notes: "Ad spend excluded, paid directly by the client." }),
  seed({ item_key: "connected_assistant", brand: "local", kind: "offer", name_fr: "Assistant connecté", name_es: "Asistente conectado", unit: "month", price_mode: "range", one_time_min_minor: E(700), one_time_max_minor: E(1500), monthly_min_minor: E(149), monthly_max_minor: E(299) }),
  seed({ item_key: "chatgpt_ads_management", brand: "consulting", kind: "service", name_fr: "Gestion ChatGPT Ads (seule)", name_es: "Gestión de ChatGPT Ads (sola)", unit: "month", price_mode: "range", monthly_min_minor: E(250), monthly_max_minor: E(500), notes: "Ad spend excluded. One-off on quote." }),
  // 30/30: a distinct one-time product.
  seed({ item_key: "thirty_report", brand: "thirty", kind: "report", name_fr: "Rapport IA 30/30", name_es: "Informe IA 30/30", unit: "report", price_mode: "fixed", one_time_min_minor: E(39), one_time_max_minor: E(39), monthly_min_minor: 0, monthly_max_minor: 0, notes: "One-time, distinct product." }),
];

/** Default billing of an item: monthly when it has a recurring price and no one-off price, else one-off. */
export function defaultBilling(item: { monthly_min_minor: number | null; one_time_min_minor: number | null; unit: string }): "one_time" | "monthly" {
  if (item.unit === "month") return "monthly";
  if ((item.monthly_min_minor ?? 0) > 0 && !(item.one_time_min_minor ?? 0)) return "monthly";
  return "one_time";
}
