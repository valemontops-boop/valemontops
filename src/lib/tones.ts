/** The app's color system (D044). One meaning per color, everywhere: */
export type Tone = "sales" | "win" | "mkt" | "ops" | "ink" | "muted";
export const TONE_BAR: Record<Tone, string> = { sales: "bg-sales", win: "bg-win", mkt: "bg-mkt", ops: "bg-ops", ink: "bg-ink", muted: "bg-control" };
export const TONE_SOFT: Record<Tone, string> = { sales: "bg-sales-soft", win: "bg-win-soft", mkt: "bg-mkt-soft", ops: "bg-ops-soft", ink: "bg-subtle", muted: "bg-subtle" };
export const TONE_TEXT: Record<Tone, string> = { sales: "text-sales", win: "text-win", mkt: "text-mkt", ops: "text-ops", ink: "text-ink", muted: "text-text-2" };
export const TONE_BORDER: Record<Tone, string> = { sales: "border-sales", win: "border-win", mkt: "border-mkt", ops: "border-ops", ink: "border-ink", muted: "border-control" };
export const TONE_VAR: Record<Tone, string> = { sales: "var(--sales)", win: "var(--win)", mkt: "var(--mkt)", ops: "var(--ops)", ink: "var(--ink)", muted: "var(--control-border)" };
/** Task / My Day areas. */
export const AREA_TONE = { sales: "sales", marketing: "mkt", ops: "ops" } as const satisfies Record<string, Tone>;
