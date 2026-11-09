import { OBJECTION_LABELS, type Objection } from "./constants";
import { objectionDefaults } from "./objections";

/**
 * Call playbook: opener, objection replies and follow-up templates, in French and Spanish.
 * These are built-in starting points; a founder can override any of them in Settings › Playbook
 * (rows in the Playbook tab win over these defaults). Placeholders: {business} {contact} {founder}
 * {calendly} {deck}. Nothing here is sent automatically.
 */
export type Lang = "FR" | "ES";
export type PlaybookKind = "opener" | "objection" | "email" | "whatsapp" | "linkedin";
export const PLAYBOOK_KINDS = ["opener", "objection", "email", "whatsapp", "linkedin"] as const satisfies readonly PlaybookKind[];
export interface PlaybookItem { kind: PlaybookKind; key: string; language: Lang; subject: string; body: string }

/** Follow-up templates, in the order shown in call mode. */
export const FOLLOW_UPS = [
  { key: "calendly", label: "Email + Calendly", hotkey: "e", channel: "email" },
  { key: "deck", label: "Send the deck", hotkey: "p", channel: "email" },
  { key: "whatsapp", label: "WhatsApp", hotkey: "w", channel: "whatsapp" },
] as const;
export type FollowUpKey = (typeof FOLLOW_UPS)[number]["key"];
/** Message templates, email and WhatsApp alike. "missed" goes to people who did not pick up (cold: never to Spain without consent). */
export const TEMPLATES = ["thanks", "calendly", "deck", "confirm", "thanks_soft", "missed", "nudge", "local", "thirty"] as const;
export type TemplateKey = (typeof TEMPLATES)[number];
export const EMAIL_TEMPLATES = TEMPLATES;
export const WHATSAPP_TEMPLATES = TEMPLATES;
export const EMAIL_TEMPLATE_LABELS: Record<TemplateKey, string> = {
  thanks: "Thank you for the call", calendly: "Book a call (Calendly)", deck: "Commercial deck", confirm: "Meeting confirmation",
  thanks_soft: "Thank you, door open (after a no)", missed: "Tried to reach you (no answer)", nudge: "Nudge (no reply yet)",
  local: "Valemont Local offer (after a no to Consulting)", thirty: "30/30 link (after a no to Local)",
};
export const TEMPLATE_SHORT: Record<TemplateKey, string> = { thanks: "Thanks", calendly: "Calendly", deck: "Deck", confirm: "Confirm", thanks_soft: "Thanks (no)", missed: "Missed you", nudge: "Nudge", local: "Local offer", thirty: "30/30 link" };
/** Cold = no conversation happened: stricter rules apply (Spain needs prior consent). */
export const COLD_TEMPLATES: readonly TemplateKey[] = ["missed"];

/** LinkedIn session messages (no API: the founder copies them into LinkedIn / Sales Navigator). */
export const LINKEDIN_TEMPLATES = ["invitation", "first_dm", "follow_up", "inmail"] as const;
export type LinkedInTemplate = (typeof LINKEDIN_TEMPLATES)[number];
export const LINKEDIN_TEMPLATE_LABELS: Record<LinkedInTemplate, string> = {
  invitation: "Connection note", first_dm: "First message after acceptance", follow_up: "Follow-up message", inmail: "InMail",
};
/** LinkedIn caps a connection note at 300 characters. */
export const LINKEDIN_NOTE_MAX = 300;

const D: PlaybookItem[] = [
  { kind: "opener", key: "default", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Je serai bref : quand un client vous appelle pendant que vous êtes sur un chantier, qui lui répond ? On met en place un système qui capte chaque demande, la qualifie et vous prévient tout de suite. Ça vous parle ?" },
  { kind: "opener", key: "default", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Seré breve: cuando un cliente le llama mientras está trabajando, ¿quién le contesta? Montamos un sistema que recoge cada solicitud, la cualifica y le avisa al momento. ¿Le suena el problema?" },

  // Downsell ladder (D071): said live, after a no to Consulting (Local), then after a no to Local (30/30). Three lines.
  { kind: "opener", key: "pitch_local", language: "FR", subject: "", body: "Je comprends, le Consulting n'est peut-être pas pour maintenant.\nOn a une formule plus légère : Valemont Local, {local_price} par mois, sans engagement.\nOn met en place l'essentiel pour ne plus perdre d'appels. On essaie ?" },
  { kind: "opener", key: "pitch_local", language: "ES", subject: "", body: "Lo entiendo, quizá el Consulting no sea para ahora.\nTenemos una fórmula más ligera: Valemont Local, {local_price} al mes, sin permanencia.\nMontamos lo esencial para no perder más llamadas. ¿Lo probamos?" },
  { kind: "opener", key: "pitch_thirty", language: "FR", subject: "", body: "Pas de souci. Dernière idée, et elle est gratuite à regarder :\n30/30, notre outil d'IA, vous fait gagner du temps sur vos devis et vos messages.\nJe vous envoie le lien par mail, vous regardez quand vous voulez ?" },
  { kind: "opener", key: "pitch_thirty", language: "ES", subject: "", body: "Sin problema. Una última idea, y mirarla no cuesta nada:\n30/30, nuestra herramienta de IA, le ahorra tiempo en presupuestos y mensajes.\n¿Le envío el enlace por email y lo mira cuando quiera?" },

  ...objectionDefaults(),

  { kind: "email", key: "calendly", language: "FR", subject: "Suite à notre appel, {business}", body: "Bonjour {contact},\n\nMerci pour votre temps au téléphone. Comme convenu, voici mon lien pour choisir un créneau de 15 minutes :\n{calendly}\n\nJe vous montrerai concrètement comment chaque demande est captée, qualifiée et relancée.\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "calendly", language: "ES", subject: "Tras nuestra llamada, {business}", body: "Hola {contact}:\n\nGracias por su tiempo al teléfono. Como hablamos, aquí tiene mi enlace para elegir 15 minutos:\n{calendly}\n\nLe enseñaré cómo se recoge, se cualifica y se sigue cada solicitud.\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "deck", language: "FR", subject: "La présentation promise, {business}", body: "Bonjour {contact},\n\nComme promis, voici notre présentation :\n{deck}\n\nSi ça vous parle, choisissez 15 minutes ici :\n{calendly}\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "deck", language: "ES", subject: "La presentación prometida, {business}", body: "Hola {contact}:\n\nComo le prometí, aquí tiene nuestra presentación:\n{deck}\n\nSi le interesa, reserve 15 minutos aquí:\n{calendly}\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "confirm", language: "FR", subject: "Notre rendez-vous, {business}", body: "Bonjour {contact},\n\nMerci, c'est noté pour notre rendez-vous. Si le créneau ne vous convient plus, vous pouvez le déplacer ici :\n{calendly}\n\nÀ bientôt,\n{signature}" },
  { kind: "email", key: "confirm", language: "ES", subject: "Nuestra reunión, {business}", body: "Hola {contact}:\n\nGracias, queda anotada nuestra reunión. Si el horario ya no le va bien, puede cambiarlo aquí:\n{calendly}\n\nHasta pronto,\n{signature}" },

  { kind: "email", key: "local", language: "FR", subject: "Valemont Local, comme évoqué au téléphone", body: "Bonjour {contact},\n\nMerci pour l'échange. Comme évoqué, voici Valemont Local : {local_price} par mois, sans engagement, pour ne plus perdre d'appels ni de demandes.\n\nPour démarrer, il suffit de répondre « oui » à ce mail, ou de choisir 15 minutes ici :\n{calendly}\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "local", language: "ES", subject: "Valemont Local, como hablamos por teléfono", body: "Hola {contact}:\n\nGracias por la conversación. Como le comenté, esto es Valemont Local: {local_price} al mes, sin permanencia, para no perder más llamadas ni solicitudes.\n\nPara empezar, basta con responder «sí» a este email, o elegir 15 minutos aquí:\n{calendly}\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "thirty", language: "FR", subject: "Le lien 30/30 promis", body: "Bonjour {contact},\n\nComme promis au téléphone, voici 30/30, notre outil d'IA pour gagner du temps sur vos devis et vos messages :\n{thirty}\n\nRegardez quand vous voulez, et dites-moi ce que vous en pensez.\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "thirty", language: "ES", subject: "El enlace de 30/30 prometido", body: "Hola {contact}:\n\nComo le prometí por teléfono, aquí tiene 30/30, nuestra herramienta de IA para ahorrar tiempo en presupuestos y mensajes:\n{thirty}\n\nÉchele un vistazo cuando quiera y dígame qué le parece.\n\nUn saludo,\n{signature}" },

  { kind: "email", key: "thanks", language: "FR", subject: "Merci pour votre temps, {business}", body: "Bonjour {contact},\n\nMerci d'avoir pris le temps de me répondre tout à l'heure.\n\nComme convenu, je reviens vers vous à la date prévue. Si vous voulez avancer plus vite, voici mon lien pour réserver 15 minutes :\n{calendly}\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "thanks", language: "ES", subject: "Gracias por su tiempo, {business}", body: "Hola {contact}:\n\nGracias por atenderme hace un rato.\n\nComo hablamos, le vuelvo a llamar en la fecha prevista. Si quiere avanzar antes, aquí tiene mi enlace para reservar 15 minutos:\n{calendly}\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "thanks_soft", language: "FR", subject: "Merci pour votre accueil", body: "Bonjour {contact},\n\nMerci d'avoir pris mon appel tout à l'heure, même si ce n'est pas le moment.\n\nSi un jour les appels manqués ou les devis sans réponse deviennent un sujet, il vous suffit de répondre à ce mail.\n\nBonne continuation,\n{signature}" },
  { kind: "email", key: "thanks_soft", language: "ES", subject: "Gracias por atenderme", body: "Hola {contact}:\n\nGracias por atender mi llamada, aunque no sea el momento.\n\nSi algún día las llamadas perdidas o los presupuestos sin respuesta se convierten en un problema, solo tiene que responder a este email.\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "missed", language: "FR", subject: "J'ai essayé de vous joindre, {business}", body: "Bonjour {contact},\n\nJ'ai essayé de vous appeler aujourd'hui : vous étiez sûrement sur un chantier.\n\nC'est justement pour ça que je vous écris : un appel manqué pendant que vous travaillez, c'est souvent un client qui part ailleurs. Nous mettons en place un système qui répond, qualifie la demande et vous prévient tout de suite.\n\nSi ça vous parle, choisissez 15 minutes ici :\n{calendly}\n\nBonne journée,\n{signature}" },
  { kind: "email", key: "missed", language: "ES", subject: "He intentado llamarle, {business}", body: "Hola {contact}:\n\nHe intentado llamarle hoy: seguramente estaba trabajando.\n\nPor eso le escribo: una llamada perdida mientras trabaja suele ser un cliente que se va a otro. Montamos un sistema que contesta, cualifica la solicitud y le avisa al momento.\n\nSi le interesa, reserve 15 minutos aquí:\n{calendly}\n\nUn saludo,\n{signature}" },
  { kind: "email", key: "nudge", language: "FR", subject: "Re : {business}", body: "Bonjour {contact},\n\nJe me permets de revenir vers vous après mon dernier message. Est-ce toujours d'actualité, ou je classe le dossier ?\n\nMon lien si vous voulez en parler 15 minutes :\n{calendly}\n\n{signature}" },
  { kind: "email", key: "nudge", language: "ES", subject: "Re: {business}", body: "Hola {contact}:\n\nLe escribo de nuevo tras mi último mensaje. ¿Sigue siendo de interés, o cierro el tema?\n\nMi enlace si quiere hablarlo 15 minutos:\n{calendly}\n\n{signature}" },

  { kind: "whatsapp", key: "thanks", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Merci pour votre temps au téléphone tout à l'heure ! Mon lien si vous voulez caler 15 min : {calendly}" },
  { kind: "whatsapp", key: "thanks", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. ¡Gracias por su tiempo al teléfono! Mi enlace por si quiere reservar 15 min: {calendly}" },
  { kind: "whatsapp", key: "confirm", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. C'est noté pour notre rendez-vous, merci ! Pour le déplacer : {calendly}" },
  { kind: "whatsapp", key: "confirm", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Queda anotada nuestra reunión, ¡gracias! Para cambiarla: {calendly}" },
  { kind: "whatsapp", key: "thanks_soft", language: "FR", subject: "", body: "Bonjour {contact}, merci d'avoir pris mon appel tout à l'heure. Si le sujet revient un jour, vous avez mon numéro. Bonne journée ! {founder}, Valemont" },
  { kind: "whatsapp", key: "thanks_soft", language: "ES", subject: "", body: "Hola {contact}, gracias por atender mi llamada. Si algún día le interesa, ya tiene mi número. ¡Buen día! {founder}, Valemont" },
  { kind: "whatsapp", key: "missed", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. J'ai essayé de vous appeler, vous étiez sûrement sur un chantier. Je vous rappelle, ou vous préférez choisir un créneau ici : {calendly} ?" },
  { kind: "whatsapp", key: "missed", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. He intentado llamarle, seguramente estaba trabajando. ¿Le vuelvo a llamar, o prefiere elegir un horario aquí: {calendly}?" },
  { kind: "whatsapp", key: "nudge", language: "FR", subject: "", body: "Bonjour {contact}, petit message pour savoir si vous avez eu le temps de regarder ? {founder}, Valemont" },
  { kind: "whatsapp", key: "nudge", language: "ES", subject: "", body: "Hola {contact}, ¿ha tenido tiempo de echarle un vistazo? {founder}, Valemont" },
  { kind: "whatsapp", key: "calendly", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont, merci pour l'appel. Voici mon lien pour caler 15 min : {calendly}" },
  { kind: "whatsapp", key: "calendly", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont, gracias por la llamada. Aquí tiene mi enlace para reservar 15 min: {calendly}" },
  { kind: "whatsapp", key: "deck", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Comme promis, notre présentation : {deck}" },
  { kind: "whatsapp", key: "deck", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Como le prometí, nuestra presentación: {deck}" },

  { kind: "whatsapp", key: "local", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Comme évoqué : Valemont Local, {local_price} par mois, sans engagement. Pour démarrer, répondez simplement « oui » ici." },
  { kind: "whatsapp", key: "local", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Como le comenté: Valemont Local, {local_price} al mes, sin permanencia. Para empezar, responda «sí» aquí." },
  { kind: "whatsapp", key: "thirty", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont. Comme promis, le lien de 30/30, notre outil d'IA : {thirty}" },
  { kind: "whatsapp", key: "thirty", language: "ES", subject: "", body: "Hola {contact}, soy {founder} de Valemont. Como le prometí, el enlace de 30/30, nuestra herramienta de IA: {thirty}" },

  { kind: "linkedin", key: "invitation", language: "FR", subject: "", body: "Bonjour {first_name}, je m'intéresse à la façon dont les entreprises comme {business} gèrent les appels manqués pendant le travail. J'aide des artisans et des PME sur ce sujet. Ravi d'échanger avec vous. {founder}" },
  { kind: "linkedin", key: "invitation", language: "ES", subject: "", body: "Hola {first_name}, me interesa saber cómo empresas como {business} gestionan las llamadas perdidas mientras trabajan. Ayudo a autónomos y pymes con este tema. Encantado de conectar. {founder}" },
  { kind: "linkedin", key: "first_dm", language: "FR", subject: "", body: "Merci pour la connexion, {first_name} !\n\nQuestion rapide : quand vous êtes occupé et qu'un client appelle, qui lui répond ? Chez Valemont, on met en place un système qui capte chaque demande, la qualifie et vous prévient tout de suite.\n\nSi le sujet vous parle, voici mon lien pour 15 minutes : {calendly}\n\n{founder}" },
  { kind: "linkedin", key: "first_dm", language: "ES", subject: "", body: "¡Gracias por conectar, {first_name}!\n\nUna pregunta rápida: cuando está ocupado y llama un cliente, ¿quién le contesta? En Valemont montamos un sistema que recoge cada solicitud, la cualifica y le avisa al momento.\n\nSi le interesa, aquí tiene mi enlace para 15 minutos: {calendly}\n\n{founder}" },
  { kind: "linkedin", key: "follow_up", language: "FR", subject: "", body: "Bonjour {first_name}, je me permets de revenir vers vous. Les appels manqués, c'est un sujet chez {business}, ou je ne vous embête plus ? Un mot de réponse me suffit. {founder}" },
  { kind: "linkedin", key: "follow_up", language: "ES", subject: "", body: "Hola {first_name}, le escribo de nuevo. ¿Las llamadas perdidas son un tema en {business}, o no le molesto más? Me basta con una palabra. {founder}" },
  { kind: "linkedin", key: "inmail", language: "FR", subject: "Les appels manqués chez {business}", body: "Bonjour {first_name},\n\nQuand vous êtes sur le terrain et qu'un client appelle, qui lui répond ? Un appel manqué, c'est souvent un client qui part ailleurs.\n\nChez Valemont, on met en place un système qui répond, qualifie chaque demande et vous prévient tout de suite.\n\nSi le sujet vous parle, 15 minutes suffisent pour vous montrer : {calendly}\n\n{signature}" },
  { kind: "linkedin", key: "inmail", language: "ES", subject: "Las llamadas perdidas en {business}", body: "Hola {first_name}:\n\nCuando está trabajando y llama un cliente, ¿quién le contesta? Una llamada perdida suele ser un cliente que se va a otro.\n\nEn Valemont montamos un sistema que contesta, cualifica cada solicitud y le avisa al momento.\n\nSi le interesa, con 15 minutos se lo enseño: {calendly}\n\n{signature}" },
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

export interface FillVars { business?: string; contact?: string; founder?: string; calendly?: string; deck?: string; signature?: string; first_name?: string; thirty?: string; local_price?: string }
/** Fills placeholders. A missing link stays visible as [add … in Settings] so nothing is sent with a hole. */
export function fill(text: string, v: FillVars): string {
  const contact = v.contact?.trim() ?? "";
  const first = v.first_name?.trim() ?? "";
  return text
    .replace(/, \{first_name\}/g, first ? `, ${first}` : "")
    .replace(/ \{first_name\}/g, first ? ` ${first}` : "")
    .replace(/\{first_name\}/g, first)
    .replace(/ \{contact\}/g, contact ? ` ${contact}` : "")
    .replace(/\{contact\}/g, contact)
    .replace(/, \{business\}/g, v.business?.trim() ? `, ${v.business.trim()}` : "")
    .replace(/\{business\}/g, v.business?.trim() ?? "")
    // Signature: the founder's own (Settings › Workspace), else "First name / Valemont".
    .replace(/\{signature\}/g, v.signature?.trim() || `${v.founder?.trim() ?? ""}\nValemont`)
    .replace(/\{founder\}/g, v.founder?.trim() ?? "")
    .replace(/\{calendly\}/g, v.calendly?.trim() || "[add your Calendly link in Settings › Workspace]")
    .replace(/\{deck\}/g, v.deck?.trim() || "[add the deck link in Settings › Workspace]")
    .replace(/\{thirty\}/g, v.thirty?.trim() || "[add the 30/30 link in Settings › Workspace]")
    .replace(/\{local_price\}/g, v.local_price?.trim() || "100 €")
    .trim();
}

/** True when a filled text still has a link placeholder that must be completed first. */
export const hasMissingLink = (text: string) => /\[add (your Calendly|the deck|the 30\/30) link/.test(text);

export const objectionLabel = (k: string) => { const [o, v] = k.split("#"); return `${OBJECTION_LABELS[o as Objection] ?? o}${v ? ` · reply ${v}` : ""}`; };

/** WhatsApp click-to-chat link (opens the app; sending is confirmed by the founder, spec 4.15). */
export function whatsappLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** WhatsApp Web on a computer (opens the chat in the browser tab), wa.me on a phone (opens the app). */
export function whatsappSendLink(phoneE164: string, text: string, mobile: boolean): string {
  if (mobile) return whatsappLink(phoneE164, text);
  return `https://web.whatsapp.com/send?phone=${phoneE164.replace(/[^\d]/g, "")}&text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** What to send after each outcome, so every call can produce a message. Gatekeepers get nothing. */
export function suggestedFollowUp(outcome: string, objections: readonly string[], offer: "local" | "thirty" | null = null): TemplateKey | null {
  if (offer === "thirty") return "thirty";
  if (offer === "local") return "local";
  if (outcome === "meeting") return "confirm";
  if (objections.includes("send_info")) return "deck";
  if (outcome === "interested") return "calendly";
  if (outcome === "call_back") return "thanks";
  if (outcome === "not_interested") return "thanks_soft";
  if (outcome === "no_answer" || outcome === "voicemail") return "missed";
  return null;
}

/** Gmail web compose, prefilled (used when Gmail sending is not connected): opens straight in Gmail, ready to send. */
export function gmailComposeLink(to: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
