/** Stage 3 finance (D078): cost centers (spec 2.1) and how a line enters the managerial P&L. Kept dependency-free for tables.ts. */
export const COST_CENTERS = ["consulting", "local", "thirty", "shared"] as const;
export type CostCenter = (typeof COST_CENTERS)[number];
export const COST_CENTER_LABELS: Record<CostCenter, string> = { consulting: "Valemont Consulting", local: "Valemont Local", thirty: "30/30 AI", shared: "Shared" };
/** revenue, direct delivery cost, operating expense, outside EBITDA (taxes, VAT, interest), neutral (contributions, transfers, loans). */
export const COST_CLASSES = ["revenue", "direct", "opex", "excluded", "neutral"] as const;
export type CostClass = (typeof COST_CLASSES)[number];
export const COST_CLASS_LABELS: Record<CostClass, string> = { revenue: "Revenue", direct: "Direct cost", opex: "Operating expense", excluded: "Outside EBITDA", neutral: "Neither income nor expense" };
