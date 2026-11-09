/**
 * Audit questionnaires and the Opportunity Summary (spec 5.9, D074). Templates are stored data (AuditTemplates tab),
 * seeded from the definitions below in French and Spanish; the summary is computed deterministically from the
 * answers and the template's rules. No LLM: every generated suggestion is flagged `draft` ("draft to validate").
 */
import { z } from "zod";

export const SECTORS = ["building_trades", "garage", "generic"] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABELS: Record<Sector, string> = { building_trades: "Building trades", garage: "Garages", generic: "Small business / consulting" };
export const COMPLEXITIES = ["simple", "detailed"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];
export const COMPLEXITY_LABELS: Record<Complexity, string> = { simple: "Short (10–12 questions)", detailed: "Detailed (up to 18 questions)" };
export const AUDIT_LANGUAGES = ["FR", "ES"] as const;
export type AuditLanguage = (typeof AUDIT_LANGUAGES)[number];

export const TOPICS = ["inbound", "response_time", "tools", "workflows", "pain_points", "budget", "privacy", "languages", "current_costs", "stakeholders", "kpis", "integrations", "security", "timeline", "sector"] as const;
export const SUMMARY_SECTIONS = ["observed_problems", "facts", "needs", "open_questions", "automation_opportunities", "risk_flags", "recommended_steps"] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
export const SUMMARY_SECTION_LABELS: Record<SummarySection, string> = {
  observed_problems: "Observed problems",
  facts: "Available facts",
  needs: "Needs",
  open_questions: "Open questions",
  automation_opportunities: "Automation opportunities",
  risk_flags: "Risk flags",
  recommended_steps: "Recommended next steps",
};

const condSchema = z.object({
  gt: z.number().optional(),
  lt: z.number().optional(),
  /** Indexes of the chosen option (options differ per language, indexes do not). */
  in: z.array(z.number().int()).optional(),
  yes: z.boolean().optional(),
  filled: z.boolean().optional(),
});
export const ruleSchema = z.object({ when: condSchema, section: z.enum(SUMMARY_SECTIONS), text: z.string().max(300) });
export const questionSchema = z.object({
  key: z.string().min(1).max(40),
  topic: z.enum(TOPICS),
  kind: z.enum(["text", "number", "choice", "yesno"]),
  text: z.string().trim().min(1).max(300),
  options: z.array(z.string().max(80)).max(8).default([]),
  unit: z.string().max(40).default(""),
  rules: z.array(ruleSchema).max(6).default([]),
});
export type AuditQuestion = z.infer<typeof questionSchema>;
export const questionsSchema = z.array(questionSchema).min(1).max(20);

export const summaryItemSchema = z.object({ text: z.string().max(600), draft: z.boolean(), source: z.string().max(40) });
export type SummaryItem = z.infer<typeof summaryItemSchema>;
export const summarySchema = z.object(Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s, z.array(summaryItemSchema).max(40)])) as Record<SummarySection, z.ZodArray<typeof summaryItemSchema>>);
export type AuditSummary = Record<SummarySection, SummaryItem[]>;

/* ---------- bilingual definitions (seed source) ---------- */

type L = { fr: string; es: string };
interface QDef {
  key: string;
  topic: (typeof TOPICS)[number];
  kind: AuditQuestion["kind"];
  core: boolean;
  q: L;
  options?: { fr: string[]; es: string[] };
  unit?: L;
  rules?: { when: z.infer<typeof condSchema>; section: SummarySection; t: L }[];
}

const BASE: QDef[] = [
  { key: "inbound_calls", topic: "inbound", kind: "number", core: true, unit: { fr: "par semaine", es: "por semana" },
    q: { fr: "Combien d'appels et de demandes entrantes recevez-vous par semaine ?", es: "¿Cuántas llamadas y solicitudes entrantes recibe por semana?" },
    rules: [{ when: { gt: 30 }, section: "observed_problems", t: { fr: "Volume élevé de demandes entrantes ({answer} par semaine).", es: "Volumen alto de solicitudes entrantes ({answer} por semana)." } },
      { when: { gt: 30 }, section: "automation_opportunities", t: { fr: "Accueil automatique des demandes (standard IA, prise de message, tri).", es: "Atención automática de las solicitudes (recepcionista IA, toma de mensajes, filtrado)." } }] },
  { key: "missed_calls", topic: "inbound", kind: "number", core: true, unit: { fr: "par semaine", es: "por semana" },
    q: { fr: "Combien d'appels manquez-vous par semaine (estimation) ?", es: "¿Cuántas llamadas pierde por semana (estimación)?" },
    rules: [{ when: { gt: 0 }, section: "observed_problems", t: { fr: "{answer} appels manqués par semaine, donc des demandes perdues.", es: "{answer} llamadas perdidas por semana, es decir, solicitudes perdidas." } },
      { when: { gt: 0 }, section: "automation_opportunities", t: { fr: "Rappel automatique (SMS ou WhatsApp) après un appel manqué.", es: "Respuesta automática (SMS o WhatsApp) tras una llamada perdida." } }] },
  { key: "response_time", topic: "response_time", kind: "choice", core: true,
    q: { fr: "En combien de temps répondez-vous à une nouvelle demande ?", es: "¿En cuánto tiempo responde a una nueva solicitud?" },
    options: { fr: ["Moins d'une heure", "Dans la journée", "1 à 2 jours", "Plus de 2 jours"], es: ["Menos de una hora", "En el día", "1 a 2 días", "Más de 2 días"] },
    rules: [{ when: { in: [2, 3] }, section: "observed_problems", t: { fr: "Délai de réponse lent ({answer}) : les prospects partent chez un concurrent.", es: "Tiempo de respuesta lento ({answer}): los clientes potenciales se van a la competencia." } },
      { when: { in: [2, 3] }, section: "automation_opportunities", t: { fr: "Réponse immédiate et qualification automatique des demandes.", es: "Respuesta inmediata y cualificación automática de las solicitudes." } }] },
  { key: "tools", topic: "tools", kind: "choice", core: true,
    q: { fr: "Comment suivez-vous vos clients et vos demandes aujourd'hui ?", es: "¿Cómo hace hoy el seguimiento de sus clientes y solicitudes?" },
    options: { fr: ["Rien (mémoire, papier)", "Tableur", "Un CRM", "Logiciel métier"], es: ["Nada (memoria, papel)", "Hoja de cálculo", "Un CRM", "Software de gestión"] },
    rules: [{ when: { in: [0, 1] }, section: "needs", t: { fr: "Un outil central pour suivre les demandes et les relances.", es: "Una herramienta central para seguir las solicitudes y los seguimientos." } }] },
  { key: "workflows", topic: "workflows", kind: "text", core: true,
    q: { fr: "Quelles tâches répétitives vous prennent le plus de temps chaque semaine ?", es: "¿Qué tareas repetitivas le quitan más tiempo cada semana?" },
    rules: [{ when: { filled: true }, section: "automation_opportunities", t: { fr: "À automatiser en priorité : {answer}.", es: "A automatizar en prioridad: {answer}." } }] },
  { key: "pain_points", topic: "pain_points", kind: "text", core: true,
    q: { fr: "Quel est le problème qui vous coûte le plus aujourd'hui ?", es: "¿Cuál es el problema que más le cuesta hoy?" },
    rules: [{ when: { filled: true }, section: "observed_problems", t: { fr: "Selon le client : {answer}.", es: "Según el cliente: {answer}." } }] },
  { key: "budget", topic: "budget", kind: "choice", core: true,
    q: { fr: "Quel budget mensuel pouvez-vous consacrer à ce sujet ?", es: "¿Qué presupuesto mensual puede dedicar a este tema?" },
    options: { fr: ["Moins de 100 €", "100 à 300 €", "300 à 1 000 €", "Plus de 1 000 €", "Je ne sais pas"], es: ["Menos de 100 €", "100 a 300 €", "300 a 1.000 €", "Más de 1.000 €", "No lo sé"] },
    rules: [{ when: { in: [0, 1] }, section: "recommended_steps", t: { fr: "Budget serré : proposer l'offre d'entrée Valemont Local.", es: "Presupuesto ajustado: proponer la oferta de entrada Valemont Local." } },
      { when: { in: [2, 3] }, section: "recommended_steps", t: { fr: "Budget compatible avec une mission Valemont Consulting : chiffrer les modules.", es: "Presupuesto compatible con una misión de Valemont Consulting: valorar los módulos." } },
      { when: { in: [4] }, section: "open_questions", t: { fr: "Budget à confirmer avec le décideur.", es: "Presupuesto a confirmar con quien decide." } }] },
  { key: "privacy", topic: "privacy", kind: "yesno", core: true,
    q: { fr: "Traitez-vous des données sensibles (santé, finances, données d'enfants) ?", es: "¿Trata datos sensibles (salud, finanzas, datos de menores)?" },
    rules: [{ when: { yes: true }, section: "risk_flags", t: { fr: "Données sensibles : RGPD, hébergement dans l'UE et accès limités à prévoir.", es: "Datos sensibles: prever RGPD, alojamiento en la UE y accesos limitados." } }] },
  { key: "languages", topic: "languages", kind: "choice", core: false,
    q: { fr: "Dans quelles langues parlent vos clients ?", es: "¿En qué idiomas hablan sus clientes?" },
    options: { fr: ["Français seulement", "Espagnol seulement", "Français et espagnol", "D'autres langues aussi"], es: ["Solo francés", "Solo español", "Francés y español", "También otros idiomas"] },
    rules: [{ when: { in: [2, 3] }, section: "needs", t: { fr: "Réponses dans plusieurs langues ({answer}).", es: "Respuestas en varios idiomas ({answer})." } }] },
  { key: "current_costs", topic: "current_costs", kind: "number", core: false, unit: { fr: "€ par mois", es: "€ al mes" },
    q: { fr: "Combien vous coûtent aujourd'hui vos outils et le temps administratif (estimation mensuelle) ?", es: "¿Cuánto le cuestan hoy sus herramientas y el tiempo administrativo (estimación mensual)?" },
    rules: [{ when: { gt: 300 }, section: "needs", t: { fr: "Réduire un coût actuel d'environ {answer} € par mois.", es: "Reducir un coste actual de unos {answer} € al mes." } }] },
  { key: "stakeholders", topic: "stakeholders", kind: "text", core: true,
    q: { fr: "Qui décide, et qui utilisera la solution au quotidien ?", es: "¿Quién decide y quién usará la solución a diario?" },
    rules: [{ when: { filled: false }, section: "risk_flags", t: { fr: "Décideur non identifié.", es: "Persona que decide no identificada." } }] },
  { key: "kpis", topic: "kpis", kind: "text", core: true,
    q: { fr: "Dans 3 mois, qu'est-ce qui vous ferait dire que c'est réussi ?", es: "Dentro de 3 meses, ¿qué le haría decir que ha sido un éxito?" },
    rules: [{ when: { filled: true }, section: "recommended_steps", t: { fr: "Mesurer le succès sur : {answer}.", es: "Medir el éxito con: {answer}." } },
      { when: { filled: false }, section: "risk_flags", t: { fr: "Pas d'indicateur de succès défini.", es: "Sin indicador de éxito definido." } }] },
  { key: "integrations", topic: "integrations", kind: "text", core: false,
    q: { fr: "Quels outils doivent être connectés (agenda, logiciel métier, compta) ?", es: "¿Qué herramientas deben conectarse (agenda, software de gestión, contabilidad)?" },
    rules: [{ when: { filled: true }, section: "risk_flags", t: { fr: "Intégrations à vérifier avant de chiffrer : {answer}.", es: "Integraciones a verificar antes de presupuestar: {answer}." } }] },
  { key: "security", topic: "security", kind: "yesno", core: false,
    q: { fr: "Avez-vous des exigences de sécurité informatique (accès, mots de passe, prestataire IT) ?", es: "¿Tiene requisitos de seguridad informática (accesos, contraseñas, proveedor de TI)?" },
    rules: [{ when: { yes: true }, section: "risk_flags", t: { fr: "Exigences de sécurité à intégrer au périmètre.", es: "Requisitos de seguridad a incluir en el alcance." } }] },
  { key: "timeline", topic: "timeline", kind: "choice", core: true,
    q: { fr: "Quand voulez-vous démarrer ?", es: "¿Cuándo quiere empezar?" },
    options: { fr: ["Tout de suite", "Dans le mois", "Dans 1 à 3 mois", "Plus tard"], es: ["Ya mismo", "Este mes", "En 1 a 3 meses", "Más adelante"] },
    rules: [{ when: { in: [0, 1] }, section: "recommended_steps", t: { fr: "Démarrage rapide : proposer une date de lancement sous deux semaines.", es: "Inicio rápido: proponer una fecha de arranque en dos semanas." } }] },
];

const SECTOR_Q: Record<Sector, QDef[]> = {
  building_trades: [
    { key: "bt_on_site", topic: "sector", kind: "yesno", core: true,
      q: { fr: "Êtes-vous souvent sur chantier sans pouvoir répondre au téléphone ?", es: "¿Está a menudo en obra sin poder contestar al teléfono?" },
      rules: [{ when: { yes: true }, section: "observed_problems", t: { fr: "Appels perdus pendant les chantiers.", es: "Llamadas perdidas durante las obras." } }] },
    { key: "bt_quotes", topic: "sector", kind: "number", core: false, unit: { fr: "devis par mois", es: "presupuestos al mes" },
      q: { fr: "Combien de devis envoyez-vous par mois ?", es: "¿Cuántos presupuestos envía al mes?" },
      rules: [{ when: { gt: 10 }, section: "automation_opportunities", t: { fr: "Relance automatique des devis non signés.", es: "Seguimiento automático de los presupuestos no firmados." } }] },
    { key: "bt_followup", topic: "sector", kind: "choice", core: false,
      q: { fr: "Relancez-vous les devis envoyés ?", es: "¿Hace seguimiento de los presupuestos enviados?" },
      options: { fr: ["Jamais", "Parfois", "Toujours"], es: ["Nunca", "A veces", "Siempre"] },
      rules: [{ when: { in: [0, 1] }, section: "observed_problems", t: { fr: "Devis peu ou pas relancés.", es: "Presupuestos con poco o ningún seguimiento." } }] },
  ],
  garage: [
    { key: "g_booking", topic: "sector", kind: "choice", core: true,
      q: { fr: "Comment vos clients prennent-ils rendez-vous ?", es: "¿Cómo piden cita sus clientes?" },
      options: { fr: ["Téléphone uniquement", "En ligne", "Les deux"], es: ["Solo por teléfono", "En línea", "Ambos"] },
      rules: [{ when: { in: [0] }, section: "automation_opportunities", t: { fr: "Prise de rendez-vous en ligne avec rappels automatiques.", es: "Cita en línea con recordatorios automáticos." } }] },
    { key: "g_reminders", topic: "sector", kind: "yesno", core: false,
      q: { fr: "Envoyez-vous des rappels d'entretien ou de contrôle technique ?", es: "¿Envía recordatorios de mantenimiento o de ITV?" },
      rules: [{ when: { yes: false }, section: "automation_opportunities", t: { fr: "Rappels d'entretien et de contrôle technique (avec consentement).", es: "Recordatorios de mantenimiento e ITV (con consentimiento)." } }] },
    { key: "g_ready", topic: "sector", kind: "yesno", core: false,
      q: { fr: "Prévenez-vous automatiquement le client quand le véhicule est prêt ?", es: "¿Avisa automáticamente al cliente cuando el vehículo está listo?" },
      rules: [{ when: { yes: false }, section: "automation_opportunities", t: { fr: "Message « véhicule prêt » envoyé automatiquement.", es: "Mensaje «vehículo listo» enviado automáticamente." } }] },
  ],
  generic: [
    { key: "s_team", topic: "sector", kind: "number", core: true, unit: { fr: "personnes", es: "personas" },
      q: { fr: "Combien de personnes travaillent dans l'entreprise ?", es: "¿Cuántas personas trabajan en la empresa?" } },
    { key: "s_sources", topic: "sector", kind: "text", core: false,
      q: { fr: "D'où viennent vos nouveaux clients aujourd'hui ?", es: "¿De dónde vienen hoy sus nuevos clientes?" } },
    { key: "s_reporting", topic: "sector", kind: "choice", core: false,
      q: { fr: "Comment suivez-vous vos chiffres (ventes, demandes) ?", es: "¿Cómo sigue sus cifras (ventas, solicitudes)?" },
      options: { fr: ["Pas de suivi", "Tableur", "Tableau de bord"], es: ["Sin seguimiento", "Hoja de cálculo", "Panel de control"] },
      rules: [{ when: { in: [0, 1] }, section: "needs", t: { fr: "Un tableau de bord simple des demandes et des ventes.", es: "Un panel simple de solicitudes y ventas." } }] },
  ],
};

const SECTOR_TITLES: Record<Sector, L> = {
  building_trades: { fr: "Artisans du bâtiment", es: "Oficios de la construcción" },
  garage: { fr: "Garages automobiles", es: "Talleres mecánicos" },
  generic: { fr: "PME et conseil", es: "Pymes y consultoría" },
};

export interface AuditTemplateSeed {
  template_key: string;
  sector: Sector;
  complexity: Complexity;
  language: AuditLanguage;
  title: string;
  questions: AuditQuestion[];
}

export function auditTemplateSeeds(): AuditTemplateSeed[] {
  const out: AuditTemplateSeed[] = [];
  for (const sector of SECTORS)
    for (const complexity of COMPLEXITIES)
      for (const language of AUDIT_LANGUAGES) {
        const l = language === "FR" ? "fr" : "es";
        const defs = [...BASE, ...SECTOR_Q[sector]].filter((d) => complexity === "detailed" || d.core);
        out.push({
          template_key: `${sector}.${complexity}.${language}`,
          sector, complexity, language,
          title: `${SECTOR_TITLES[sector][l]} · ${complexity === "simple" ? (l === "fr" ? "court" : "corto") : (l === "fr" ? "détaillé" : "detallado")}`,
          questions: defs.map((d) => ({
            key: d.key, topic: d.topic, kind: d.kind, text: d.q[l], options: d.options?.[l] ?? [], unit: d.unit?.[l] ?? "",
            rules: (d.rules ?? []).map((r) => ({ when: r.when, section: r.section, text: r.t[l] })),
          })),
        });
      }
  return out;
}

/* ---------- summary ---------- */

const YES = { FR: "oui", ES: "sí" } as const;
const NO = { FR: "non", ES: "no" } as const;
const GENERIC_STEPS: Record<AuditLanguage, string[]> = {
  FR: ["Relire ce résumé avec le client et corriger ce qui est faux.", "Préparer une proposition chiffrée à partir de ce résumé."],
  ES: ["Revisar este resumen con el cliente y corregir lo que no sea correcto.", "Preparar una propuesta con precios a partir de este resumen."],
};

export function answerLabel(q: AuditQuestion, raw: string | undefined, lang: AuditLanguage): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (q.kind === "yesno") return v === "yes" ? YES[lang] : v === "no" ? NO[lang] : v;
  if (q.kind === "number" && q.unit) return `${v} ${q.unit}`;
  return v;
}

function matches(q: AuditQuestion, raw: string, when: z.infer<typeof condSchema>): boolean {
  const v = raw.trim();
  if (when.filled !== undefined) return when.filled ? v !== "" : v === "";
  if (!v) return false;
  if (when.yes !== undefined) return when.yes ? v === "yes" : v === "no";
  if (when.in) return when.in.includes(q.options.indexOf(v));
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) return false;
  if (when.gt !== undefined && !(n > when.gt)) return false;
  if (when.lt !== undefined && !(n < when.lt)) return false;
  return when.gt !== undefined || when.lt !== undefined;
}

/**
 * Opportunity Summary from the answers and the template rules. Facts are the client's own answers; unanswered
 * questions become open questions; everything a rule suggests is marked draft (to validate by a founder).
 */
export function auditSummary(questions: AuditQuestion[], answers: Record<string, string>, lang: AuditLanguage): AuditSummary {
  const out = Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s, [] as SummaryItem[]])) as AuditSummary;
  const push = (s: SummarySection, item: SummaryItem) => {
    if (!out[s].some((x) => x.text === item.text)) out[s].push(item);
  };
  for (const q of questions) {
    const raw = answers[q.key] ?? "";
    const label = answerLabel(q, raw, lang);
    if (label) push("facts", { text: `${q.text} ${label}`, draft: false, source: q.key });
    else push("open_questions", { text: q.text, draft: false, source: q.key });
    // Numbers are inserted bare (the rule text carries its own unit).
    const inserted = q.kind === "number" ? raw.trim() : label.replace(/\.$/, "");
    for (const r of q.rules) if (matches(q, raw, r.when)) push(r.section, { text: r.text.replace("{answer}", inserted), draft: true, source: q.key });
  }
  for (const s of GENERIC_STEPS[lang]) push("recommended_steps", { text: s, draft: true, source: "template" });
  return out;
}

export function auditProgress(questions: AuditQuestion[], answers: Record<string, string>): { answered: number; total: number } {
  return { answered: questions.filter((q) => (answers[q.key] ?? "").trim()).length, total: questions.length };
}

/* ---------- note templates (discovery call and client audit), FR / ES ---------- */

export const NOTE_TEMPLATES: Record<"discovery" | "audit_report", Record<AuditLanguage, string>> = {
  discovery: {
    FR: `# Appel découverte · {client}\nDate : {date} · Avec : {contact} · Par : {founder}\n\n## Contexte\n- Activité, taille, zone :\n- Comment ils nous ont connus :\n\n## Situation actuelle\n- Demandes entrantes par semaine :\n- Appels manqués / délai de réponse :\n- Outils utilisés :\n\n## Problème principal (mots du client)\n-\n\n## Ce qui serait un succès dans 3 mois\n-\n\n## Décision\n- Qui décide :\n- Budget évoqué :\n- Calendrier :\n\n## Prochaine étape (date)\n-\n`,
    ES: `# Llamada de descubrimiento · {client}\nFecha: {date} · Con: {contact} · Por: {founder}\n\n## Contexto\n- Actividad, tamaño, zona:\n- Cómo nos conocieron:\n\n## Situación actual\n- Solicitudes entrantes por semana:\n- Llamadas perdidas / tiempo de respuesta:\n- Herramientas usadas:\n\n## Problema principal (palabras del cliente)\n-\n\n## Qué sería un éxito dentro de 3 meses\n-\n\n## Decisión\n- Quién decide:\n- Presupuesto mencionado:\n- Plazos:\n\n## Próximo paso (fecha)\n-\n`,
  },
  audit_report: {
    FR: `# Audit · {client}\nPréparé par {founder} le {date}. Brouillon à valider avec le client.\n\n## Ce que nous avons observé\n-\n\n## Les faits (vos réponses)\n-\n\n## Vos besoins\n-\n\n## Ce qui peut être automatisé\n-\n\n## Points d'attention\n-\n\n## Questions encore ouvertes\n-\n\n## Étapes recommandées\n1.\n2.\n3.\n`,
    ES: `# Auditoría · {client}\nPreparada por {founder} el {date}. Borrador a validar con el cliente.\n\n## Lo que hemos observado\n-\n\n## Los hechos (sus respuestas)\n-\n\n## Sus necesidades\n-\n\n## Lo que se puede automatizar\n-\n\n## Puntos de atención\n-\n\n## Preguntas aún abiertas\n-\n\n## Pasos recomendados\n1.\n2.\n3.\n`,
  },
};

export function fillNote(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-z]+)\}/g, (m, k: string) => vars[k] ?? m);
}
