import type { FounderKey } from "./constants";

/**
 * Task templates from the founder brief (round 8). Titles are DATA written to Sheets, so each founder's copy is in
 * their own language (Théo FR, Pablo ES). "Both" = one task per founder, each in their language (D068).
 * Seeded once by the baseline, idempotent by a deterministic id (`seed-task`, key, founder) and `source_id` = key.
 */
export type SeedArea = "sales" | "marketing" | "ops";
export interface TaskSeed {
  key: string;
  area: SeedArea;
  title: Partial<Record<FounderKey, string>>;
  recurrence: "none" | "weekdays" | "weekly";
  /** Weekly on these weekdays (5 = Friday). */
  days?: number[];
  priority: "P0" | "P1" | "P2" | "P3";
  minutes: number | null;
  /** One-off tasks: due this many workdays after seeding. */
  dueInDays?: number;
}

const both = (fr: string, es: string) => ({ theo: fr, pablo: es });
/** Outreach lines have no minutes: their time is counted from the logged activity (minutes per action). */
const daily = (key: string, area: SeedArea, fr: string, es: string, minutes: number | null): TaskSeed => ({ key: `daily-${key}`, area, title: both(fr, es), recurrence: "weekdays", priority: "P2", minutes });

export const DAILY_CHECKLIST: TaskSeed[] = [
  // Sales
  daily("inbound", "sales", "Traiter les messages entrants et les rendez-vous prioritaires", "Atender los mensajes entrantes y las reuniones prioritarias", 30),
  daily("prepare", "sales", "Préparer et qualifier les entreprises à contacter", "Preparar y cualificar las empresas a contactar", 45),
  daily("calls", "sales", "Appels à froid", "Llamadas en frío", null),
  daily("linkedin", "sales", "Approches LinkedIn avec Sales Navigator", "Contactos en LinkedIn con Sales Navigator", null),
  // Round 9 (D073): email is the follow-up channel of calls, mainly for prospects a call did not land with.
  daily("emails", "sales", "Emails ciblés, surtout aux prospects sans temps au téléphone ou injoignables", "Emails personalizados, sobre todo a quien no tenía tiempo al teléfono o no se pudo localizar", null),
  daily("follow-ups", "sales", "Relances prévues aujourd'hui", "Seguimientos previstos para hoy", null),
  daily("meetings", "sales", "Tenir les rendez-vous et envoyer les propositions", "Hacer las reuniones y enviar las propuestas", 60),
  // Marketing and comms
  daily("publish", "marketing", "Publier le contenu prévu sur les pages Valemont et 30/30", "Publicar el contenido previsto en las páginas de Valemont y 30/30", 20),
  daily("replies", "marketing", "Répondre aux commentaires et messages des comptes pro", "Responder a los comentarios y mensajes de las cuentas de empresa", 15),
  daily("engage", "marketing", "Interagir avec les comptes cibles en FR/ES", "Interactuar con las cuentas objetivo en FR/ES", 15),
  daily("site-stats", "marketing", "Vérifier visites du site, clics et conversions", "Revisar visitas a la web, clics y conversiones", 10),
  // Product and ops
  daily("urgent", "ops", "Traiter les demandes clients urgentes ou incidents", "Atender las peticiones urgentes de clientes o incidencias", 15),
  daily("tech", "ops", "Technique : seulement ce qu'il faut pour une vente ou une livraison", "Técnica: solo lo necesario para una venta o una entrega", 30),
  daily("automations", "ops", "Vérifier formulaires, chatbots et automatisations en ligne", "Revisar formularios, chatbots y automatizaciones en producción", 10),
  // Management (ops area)
  daily("crm", "ops", "Mettre à jour tous les prospects et prochaines actions dans le CRM", "Actualizar todos los prospectos y próximas acciones en el CRM", 15),
  daily("money", "ops", "Enregistrer ventes, paiements et dépenses", "Registrar ventas, cobros y gastos", 10),
  daily("report", "ops", "Envoyer le rapport du jour et les blocages à Pablo", "Enviar el informe del día y los bloqueos a Théo", 5),
];

export const ONE_OFF_TASKS: TaskSeed[] = [
  { key: "site-fr-es", area: "ops", priority: "P1", recurrence: "none", minutes: 180, dueInDays: 2, title: { theo: "Finaliser le site FR/ES et tester chaque formulaire, lien et réservation" } },
  { key: "thirty-purchase", area: "ops", priority: "P1", recurrence: "none", minutes: 90, dueInDays: 2, title: { theo: "Tester l'achat et la livraison 30/30, corriger l'incohérence 9/15 questions" } },
  { key: "crm-statuses", area: "ops", priority: "P1", recurrence: "none", minutes: 120, dueInDays: 1, title: { theo: "Créer le CRM partagé, les statuts de vente et le rapport quotidien" } },
  { key: "video-templates", area: "marketing", priority: "P1", recurrence: "none", minutes: 180, dueInDays: 4, title: { theo: "Créer les modèles vidéo 30/30 et Valemont et les deux écrans de fin FR/ES" } },
  { key: "pablo-meetings", area: "sales", priority: "P1", recurrence: "none", minutes: 60, dueInDays: 1, title: { pablo: "Centralizar los resultados de mis dos reuniones y todos los seguimientos en curso" } },
  { key: "es-copy", area: "marketing", priority: "P1", recurrence: "none", minutes: 90, dueInDays: 3, title: { pablo: "Validar los textos en español, las voces, los CTA y los enlaces locales" } },
  { key: "reserve-100", area: "sales", priority: "P1", recurrence: "none", minutes: 240, dueInDays: 3, title: both("Constituer une première réserve de 100 prospects qualifiés (marché FR), puis l'alimenter chaque jour", "Crear una primera reserva de 100 prospectos cualificados (mercado ES) y ampliarla cada día") },
  { key: "offer-tiers", area: "sales", priority: "P1", recurrence: "none", minutes: 60, dueInDays: 2, title: both("Valider les offres Local, Implémentation et Consulting : prix et limites de livraison", "Validar las ofertas Local, Implementación y Consulting: precio y límites de entrega") },
  { key: "check-costs", area: "ops", priority: "P2", recurrence: "none", minutes: 30, dueInDays: 4, title: both("Vérifier les dépenses, Wise, Netlify et Google Workspace", "Revisar los gastos, Wise, Netlify y Google Workspace") },
  { key: "friday-review", area: "sales", priority: "P1", recurrence: "weekly", days: [5], minutes: 30, title: both("Revue commerciale du vendredi (30 min)", "Revisión comercial del viernes (30 min)") },
];

/**
 * Earlier seed titles of a template, per founder (D073). The baseline renames an OPEN system row (todo, not archived)
 * whose title is still exactly one of these to the current seed title; a title the founder changed is never touched,
 * and done rows keep their history.
 */
export const PREVIOUS_SEED_TITLES: Record<string, Partial<Record<FounderKey, string[]>>> = {
  "daily-emails": { theo: ["Emails ciblés"], pablo: ["Emails personalizados"] },
};

export const TASK_SEEDS: TaskSeed[] = [...DAILY_CHECKLIST, ...ONE_OFF_TASKS];
