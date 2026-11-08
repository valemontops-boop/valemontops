import { LIVE_OBJECTIONS, OBJECTION_LABELS, type Objection } from "./constants";

/**
 * Call playbook: opener, objection replies and follow-up templates, in French and Spanish.
 * These are built-in starting points; a founder can override any of them in Settings › Playbook
 * (rows in the Playbook tab win over these defaults). Placeholders: {business} {contact} {founder}
 * {calendly} {deck}. Nothing here is sent automatically.
 */
export type Lang = "FR" | "ES";
export type PlaybookKind = "opener" | "objection" | "email" | "whatsapp";
export interface PlaybookItem { kind: PlaybookKind; key: string; language: Lang; subject: string; body: string }

/** Follow-up templates, in the order shown in call mode. */
export const FOLLOW_UPS = [
  { key: "calendly", label: "Email + Calendly", hotkey: "e", channel: "email" },
  { key: "deck", label: "Send the deck", hotkey: "p", channel: "email" },
  { key: "whatsapp", label: "WhatsApp", hotkey: "w", channel: "whatsapp" },
] as const;
export type FollowUpKey = (typeof FOLLOW_UPS)[number]["key"];
export const EMAIL_TEMPLATES = ["calendly", "deck", "confirm"] as const;
export const EMAIL_TEMPLATE_LABELS: Record<(typeof EMAIL_TEMPLATES)[number], string> = { calendly: "Book a call (Calendly)", deck: "Commercial deck", confirm: "Meeting confirmation" };
export const WHATSAPP_TEMPLATES = ["calendly", "deck"] as const;

const D: PlaybookItem[] = [
  { kind: "opener", key: "default", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Je serai bref : quand un client vous appelle pendant que vous êtes sur un chantier, qui lui répond ? On met en place un système qui capte chaque demande, la qualifie et vous prévient tout de suite. Ça vous parle ?" },
  { kind: "opener", key: "default", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Seré breve: cuando un cliente le llama mientras está trabajando, ¿quién le contesta? Montamos un sistema que recoge cada solicitud, la cualifica y le avisa al momento. ¿Le suena el problema?" },

  { kind: "objection", key: "no_need", language: "FR", subject: "", body: "Je comprends. Juste une question : combien d'appels manqués par semaine, à votre avis ? Si c'est zéro, je vous laisse tranquille." },
  { kind: "objection", key: "no_need", language: "ES", subject: "", body: "Lo entiendo. Una sola pregunta: ¿cuántas llamadas pierde a la semana? Si son cero, no le molesto más." },
  { kind: "objection", key: "no_time", language: "FR", subject: "", body: "Justement, c'est fait pour ça. 15 minutes cette semaine, je vous montre et vous jugez. Plutôt mardi ou jeudi ?" },
  { kind: "objection", key: "no_time", language: "ES", subject: "", body: "Precisamente para eso está pensado. 15 minutos esta semana, se lo enseño y usted decide. ¿Mejor martes o jueves?" },
  { kind: "objection", key: "too_expensive", language: "FR", subject: "", body: "C'est 99 € par mois. Un seul client récupéré par mois le rembourse. Combien vous rapporte un chantier moyen ?" },
  { kind: "objection", key: "too_expensive", language: "ES", subject: "", body: "Son 99 € al mes. Un solo cliente recuperado al mes lo paga. ¿Cuánto le deja un trabajo medio?" },
  { kind: "objection", key: "already_has_solution", language: "FR", subject: "", body: "Très bien. Il fait aussi la relance et la demande d'avis après l'intervention ? Si oui, gardez-le. Sinon, ça vaut 15 minutes." },
  { kind: "objection", key: "already_has_solution", language: "ES", subject: "", body: "Muy bien. ¿También hace el seguimiento y pide la reseña después del trabajo? Si es así, quédeselo. Si no, valen la pena 15 minutos." },
  { kind: "objection", key: "send_info", language: "FR", subject: "", body: "Avec plaisir. Je vous l'envoie maintenant par mail ou WhatsApp. Je vous mets aussi mon lien pour caler 15 minutes, vous choisissez le créneau." },
  { kind: "objection", key: "send_info", language: "ES", subject: "", body: "Con mucho gusto. Se lo mando ahora por email o WhatsApp, con mi enlace para reservar 15 minutos cuando le venga bien." },
  { kind: "objection", key: "not_decision_maker", language: "FR", subject: "", body: "Merci. Qui s'occupe de ça chez vous, et quel est le meilleur moment pour l'appeler ?" },
  { kind: "objection", key: "not_decision_maker", language: "ES", subject: "", body: "Gracias. ¿Quién se encarga de esto y cuándo es mejor llamarle?" },
  { kind: "objection", key: "bad_timing", language: "FR", subject: "", body: "Pas de souci. Je vous rappelle quand ? Je note la date tout de suite." },
  { kind: "objection", key: "bad_timing", language: "ES", subject: "", body: "Sin problema. ¿Cuándo le vuelvo a llamar? Lo apunto ahora mismo." },
  { kind: "objection", key: "bad_experience", language: "FR", subject: "", body: "Je comprends, ça arrive trop souvent. Qu'est-ce qui n'avait pas marché ? Chez nous : pas d'engagement caché, et vous voyez les demandes reçues chaque semaine." },
  { kind: "objection", key: "bad_experience", language: "ES", subject: "", body: "Le entiendo, pasa demasiado. ¿Qué no funcionó? Con nosotros: sin permanencia escondida y ve cada semana las solicitudes recibidas." },
  { kind: "objection", key: "other", language: "FR", subject: "", body: "Je comprends. Qu'est-ce qui vous ferait dire oui ?" },
  { kind: "objection", key: "other", language: "ES", subject: "", body: "Le entiendo. ¿Qué le haría decir que sí?" },

  { kind: "email", key: "calendly", language: "FR", subject: "Suite à notre appel, {business}", body: "Bonjour {contact},\n\nMerci pour votre temps au téléphone. Comme convenu, voici mon lien pour choisir un créneau de 15 minutes :\n{calendly}\n\nJe vous montrerai concrètement comment chaque demande est captée, qualifiée et relancée.\n\nBonne journée,\n{founder}\nValemont" },
  { kind: "email", key: "calendly", language: "ES", subject: "Tras nuestra llamada, {business}", body: "Hola {contact}:\n\nGracias por su tiempo al teléfono. Como hablamos, aquí tiene mi enlace para elegir 15 minutos:\n{calendly}\n\nLe enseñaré cómo se recoge, se cualifica y se sigue cada solicitud.\n\nUn saludo,\n{founder}\nValemont" },
  { kind: "email", key: "deck", language: "FR", subject: "La présentation promise, {business}", body: "Bonjour {contact},\n\nComme promis, voici notre présentation :\n{deck}\n\nSi ça vous parle, choisissez 15 minutes ici :\n{calendly}\n\nBonne journée,\n{founder}\nValemont" },
  { kind: "email", key: "deck", language: "ES", subject: "La presentación prometida, {business}", body: "Hola {contact}:\n\nComo le prometí, aquí tiene nuestra presentación:\n{deck}\n\nSi le interesa, reserve 15 minutos aquí:\n{calendly}\n\nUn saludo,\n{founder}\nValemont" },
  { kind: "email", key: "confirm", language: "FR", subject: "Notre rendez-vous, {business}", body: "Bonjour {contact},\n\nMerci, c'est noté pour notre rendez-vous. Si le créneau ne vous convient plus, vous pouvez le déplacer ici :\n{calendly}\n\nÀ bientôt,\n{founder}\nValemont" },
  { kind: "email", key: "confirm", language: "ES", subject: "Nuestra reunión, {business}", body: "Hola {contact}:\n\nGracias, queda anotada nuestra reunión. Si el horario ya no le va bien, puede cambiarlo aquí:\n{calendly}\n\nHasta pronto,\n{founder}\nValemont" },

  { kind: "whatsapp", key: "calendly", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont, merci pour l'appel. Voici mon lien pour caler 15 min : {calendly}" },
  { kind: "whatsapp", key: "calendly", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont, gracias por la llamada. Aquí tiene mi enlace para reservar 15 min: {calendly}" },
  { kind: "whatsapp", key: "deck", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Comme promis, notre présentation : {deck}" },
  { kind: "whatsapp", key: "deck", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Como le prometí, nuestra presentación: {deck}" },
];
export const DEFAULT_PLAYBOOK: readonly PlaybookItem[] = D;

/** Default items overridden by founder-edited rows (same kind + key + language). */
export function mergePlaybook(rows: { kind: PlaybookKind; key: string; language: Lang; subject: string; body: string; is_archived?: boolean }[]): PlaybookItem[] {
  const own = new Map(rows.filter((r) => !r.is_archived && r.body.trim()).map((r) => [`${r.kind}:${r.key}:${r.language}`, r]));
  const out = D.map((d) => {
    const o = own.get(`${d.kind}:${d.key}:${d.language}`);
    return o ? { kind: d.kind, key: d.key, language: d.language, subject: o.subject, body: o.body } : d;
  });
  return out;
}

export function findItem(items: readonly PlaybookItem[], kind: PlaybookKind, key: string, language: Lang): PlaybookItem | null {
  return items.find((i) => i.kind === kind && i.key === key && i.language === language) ?? items.find((i) => i.kind === kind && i.key === key) ?? null;
}

export interface FillVars { business?: string; contact?: string; founder?: string; calendly?: string; deck?: string }
/** Fills placeholders. A missing link stays visible as [add … in Settings] so nothing is sent with a hole. */
export function fill(text: string, v: FillVars): string {
  const contact = v.contact?.trim() ?? "";
  return text
    .replace(/ \{contact\}/g, contact ? ` ${contact}` : "")
    .replace(/\{contact\}/g, contact)
    .replace(/, \{business\}/g, v.business?.trim() ? `, ${v.business.trim()}` : "")
    .replace(/\{business\}/g, v.business?.trim() ?? "")
    .replace(/\{founder\}/g, v.founder?.trim() ?? "")
    .replace(/\{calendly\}/g, v.calendly?.trim() || "[add your Calendly link in Settings › Workspace]")
    .replace(/\{deck\}/g, v.deck?.trim() || "[add the deck link in Settings › Workspace]")
    .trim();
}

/** True when a filled text still has a link placeholder that must be completed first. */
export const hasMissingLink = (text: string) => /\[add (your Calendly|the deck) link/.test(text);

export const objectionLabel = (k: string) => OBJECTION_LABELS[k as Objection] ?? k;
export const LIVE_OBJECTION_LIST: readonly Objection[] = LIVE_OBJECTIONS;

/** WhatsApp click-to-chat link (opens the app; sending is confirmed by the founder, spec 4.15). */
export function whatsappLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type ComposerKind = "calendly" | "deck" | "confirm" | "whatsapp";
/** What to send after an outcome: a meeting gets a confirmation, "send me info" gets the deck, a yes gets the booking link. */
export function suggestedFollowUp(outcome: string, objections: readonly string[]): ComposerKind | null {
  if (outcome === "meeting") return "confirm";
  if (objections.includes("send_info")) return "deck";
  if (outcome === "interested" || outcome === "call_back") return "calendly";
  return null;
}
