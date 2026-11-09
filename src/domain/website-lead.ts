import { z } from "zod";
import { clip, safeUrl } from "./inbox";

/**
 * Website form events (Stage 4A, D083, spec 7 "Valemont and 30/30 websites"): contact, lead and booking forms of
 * the FR/ES sites, posted by the site's own server-side form handler (Netlify Function, generic handler), signed with
 * WEBSITE_WEBHOOK_SECRET. Text is trimmed and length-capped, never stripped of + - = @ (values are written RAW).
 */
export const WEBSITE_BODY_MAX = 32_000;
/** Minimum time a human needs to fill a form; faster submissions with elapsed_ms are treated as bots. */
export const MIN_FILL_MS = 1_500;

const s = (n: number) => z.string().trim().max(n).default("");
const lang = z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase().slice(0, 2) : v), z.enum(["FR", "ES"]).nullable()).default(null);
const country = z.preprocess((v) => {
  const x = typeof v === "string" ? v.trim().toUpperCase() : "";
  return ["FR", "FRANCE"].includes(x) ? "FR" : ["ES", "SPAIN", "ESPAÑA", "ESPANA", "ESPAGNE"].includes(x) ? "ES" : "";
}, z.enum(["FR", "ES", ""])).default("");

export const websiteLeadSchema = z
  .object({
    event_id: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,100}$/, "event_id: 8 to 100 letters, digits, . _ : -"),
    site: z.enum(["valemont", "thirty"]).default("valemont"),
    form_type: z.enum(["contact", "lead", "booking"]),
    language: lang,
    submitted_at: z.string().datetime({ offset: true }).optional(),
    name: s(200),
    company: s(200),
    email: z.union([z.literal(""), z.string().trim().max(200).email()]).default(""),
    phone: s(40),
    website: s(300),
    country,
    city: s(120),
    sector: s(120),
    message: z.string().max(5_000).default(""),
    /** Booking forms: the slot the visitor asked for, as text ("mardi 10 h"). */
    booking_slot: s(100),
    page_url: z.string().max(2_000).default("").transform(safeUrl),
    referrer: z.string().max(2_000).default("").transform(safeUrl),
    utm: z.object({ source: s(120), medium: s(120), campaign: s(200), term: s(200), content: s(200) }).partial().default({}),
    /** Consent exactly as captured by the form: checkbox state, the sentence shown and its version. */
    consent: z.object({ marketing: z.boolean().default(false), text: s(500), version: s(40) }).default({ marketing: false, text: "", version: "" }),
    /** Hidden field humans never fill. */
    honeypot: z.string().max(500).default(""),
    elapsed_ms: z.number().int().min(0).max(86_400_000).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), { message: "email or phone is required", path: ["email"] });
export type WebsiteLead = z.infer<typeof websiteLeadSchema>;

/** Bot traps: a filled honeypot or a form sent faster than a human can type. Such events are acknowledged and dropped. */
export const looksLikeBot = (l: Pick<WebsiteLead, "honeypot" | "elapsed_ms">) => l.honeypot.trim() !== "" || (l.elapsed_ms !== undefined && l.elapsed_ms < MIN_FILL_MS);

/** Text of the "to reply" item: form type, requested slot, message (500 characters at most). */
export function inboxExcerpt(l: WebsiteLead): string {
  const head = l.form_type === "booking" ? `[booking${l.booking_slot ? `: ${l.booking_slot}` : ""}]` : `[${l.form_type}]`;
  return clip(`${head} ${l.message}`, 500);
}
