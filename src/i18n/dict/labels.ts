/**
 * Domain label maps and fixed domain texts (src/domain/**, settings key hints).
 * Keys are the English values exactly as written in code.
 */
export const entries: Record<string, readonly [string, string]> = {
  // ---- WORK_MODE_LABELS
  "Flexible schedule": ["Horaires flexibles", "Horario flexible"],
  "Employed 35h": ["Salarié 35 h", "Empleado 35 h"],
  "Launch sprint": ["Sprint de lancement", "Sprint de lanzamiento"],
  "Custom": ["Personnalisé", "Personalizado"],
  "Day off": ["Jour off", "Día libre"],
  "Vacation": ["Vacances", "Vacaciones"],

  // ---- METRIC_LABELS
  "Calls": ["Appels", "Llamadas"],
  "Field visits": ["Visites terrain", "Visitas presenciales"],
  "LinkedIn DMs": ["Messages LinkedIn", "Mensajes de LinkedIn"],
  "Invitations": ["Invitations", "Invitaciones"],
  "InMails": ["InMails", "InMails"],
  "Cold emails": ["Emails de prospection", "Emails en frío"],
  "Follow-ups": ["Relances", "Seguimientos"],
  "Comments": ["Commentaires", "Comentarios"],
  "New businesses contacted": ["Nouvelles entreprises contactées", "Empresas nuevas contactadas"],

  // ---- ACTIVITY_LABELS
  "Call, no answer": ["Appel, pas de réponse", "Llamada, sin respuesta"],
  "Call, connected": ["Appel, décroché", "Llamada, contestada"],
  "Call, voicemail": ["Appel, messagerie", "Llamada, buzón de voz"],
  "Field visit": ["Visite terrain", "Visita presencial"],
  "LinkedIn invitation": ["Invitation LinkedIn", "Invitación de LinkedIn"],
  "LinkedIn DM": ["Message LinkedIn", "Mensaje de LinkedIn"],
  "Sales Navigator InMail": ["InMail Sales Navigator", "InMail de Sales Navigator"],
  "Cold email": ["Email de prospection", "Email en frío"],
  "Follow-up": ["Relance", "Seguimiento"],
  "Reply received": ["Réponse reçue", "Respuesta recibida"],
  "Comment": ["Commentaire", "Comentario"],
  "Demo shown": ["Démo montrée", "Demo mostrada"],
  "Meeting booked": ["RDV pris", "Reunión fijada"],
  "Meeting held": ["RDV tenu", "Reunión celebrada"],
  "Proposal sent": ["Proposition envoyée", "Propuesta enviada"],
  "Sale": ["Vente", "Venta"],

  // ---- OBJECTION_LABELS
  "No need": ["Pas besoin", "No lo necesita"],
  "No time": ["Pas le temps", "Sin tiempo"],
  "Too expensive": ["Trop cher", "Demasiado caro"],
  "Already has a solution": ["A déjà une solution", "Ya tiene una solución"],
  "Not the decision-maker": ["Pas le décideur", "No es quien decide"],
  "Call back later": ["Rappeler plus tard", "Llamar más tarde"],
  "Not interested": ["Pas intéressé", "No le interesa"],
  "Other": ["Autre", "Otro"],
  "Send me info": ["Envoyez-moi des infos", "Mándeme información"],
  "Bad timing": ["Mauvais moment", "Mal momento"],
  "Bad past experience": ["Mauvaise expérience passée", "Mala experiencia previa"],
  "I'll think about it": ["Je vais réfléchir", "Me lo pienso"],
  "Already enough work": ["A déjà assez de travail", "Ya tiene bastante trabajo"],

  // ---- OUTCOME_LABELS
  "No answer": ["Pas de réponse", "Sin respuesta"],
  "Reached gatekeeper": ["Barrage secrétariat", "Filtro (recepción)"],
  "Conversation held": ["Conversation eue", "Conversación mantenida"],
  "Interested": ["Intéressé", "Interesado"],
  "Callback requested": ["Rappel demandé", "Pide que le llamen"],
  "Demo booked": ["Démo prévue", "Demo fijada"],
  "Sent": ["Envoyés", "Enviados"],
  "Met the owner": ["Patron rencontré", "Habló con el dueño"],
  "Owner absent": ["Patron absent", "Dueño ausente"],
  "Won": ["Gagnés", "Ganados"],
  "Lost": ["Perdu", "Perdido"],

  // ---- STAGE_LABELS
  "Targeted": ["Ciblé", "Objetivo"],
  "Contacted": ["Contacté", "Contactado"],
  "Replied": ["A répondu", "Ha respondido"],
  "Discovery scheduled": ["Découverte prévue", "Descubrimiento agendado"],
  "Qualified": ["Qualifié", "Cualificado"],
  "Negotiation": ["Négociation", "Negociación"],

  // ---- STAGE_EXIT_CRITERIA
  "A first outreach attempt has been logged.": ["Une première prise de contact a été notée.", "Se ha registrado un primer intento de contacto."],
  "The business has replied on any channel.": ["L'entreprise a répondu sur un canal.", "La empresa ha respondido por algún canal."],
  "A discovery call or visit is booked with a date.": ["Un appel ou une visite de découverte est fixé avec une date.", "Hay una llamada o visita de descubrimiento con fecha."],
  "Discovery held; authority, need, urgency and money noted.": ["Découverte faite ; décideur, besoin, urgence et budget notés.", "Descubrimiento hecho; autoridad, necesidad, urgencia y presupuesto anotados."],
  "A demo has been shown to the decision-maker.": ["Une démo a été montrée au décideur.", "Se ha mostrado una demo a quien decide."],
  "A written proposal has been sent.": ["Une proposition écrite a été envoyée.", "Se ha enviado una propuesta por escrito."],
  "The client is discussing terms.": ["Le client discute des conditions.", "El cliente está negociando las condiciones."],
  "Signed agreement or explicit refusal.": ["Accord signé ou refus explicite.", "Acuerdo firmado o rechazo explícito."],
  "Client and project created.": ["Client et projet créés.", "Cliente y proyecto creados."],
  "Lost reason recorded.": ["Raison de la perte notée.", "Motivo de pérdida anotado."],

  // ---- CONTACT_TYPE_LABELS
  "Company (generic)": ["Entreprise (générique)", "Empresa (genérico)"],
  "Named professional": ["Professionnel nommé", "Profesional con nombre"],
  "Sole trader": ["Artisan / indépendant", "Autónomo"],
  "Consumer": ["Particulier", "Particular"],

  // ---- RULE_STATUSES / LEAD_STATUSES / LEAD_TYPES (values shown as words)
  "allowed": ["autorisé", "permitido"],
  "allowed with conditions": ["autorisé sous conditions", "permitido con condiciones"],
  "requires consent": ["consentement requis", "requiere consentimiento"],
  "needs review": ["à vérifier", "por revisar"],
  "Allowed": ["Autorisé", "Permitido"],
  "Allowed with conditions": ["Autorisé sous conditions", "Permitido con condiciones"],
  "Requires consent": ["Consentement requis", "Requiere consentimiento"],
  "Needs review": ["À vérifier", "Por revisar"],
  "Working": ["En cours", "En curso"],
  "Nurture": ["À entretenir", "En maduración"],
  "Customer": ["Client", "Cliente"],
  "Disqualified": ["Disqualifié", "Descartado"],
  "Referral": ["Recommandation", "Recomendación"],
  "Inbound": ["Entrant", "Entrante"],
  "Outbound": ["Sortant", "Saliente"],

  // ---- CALL_OUTCOME_LABELS (calls.ts)
  "Voicemail": ["Messagerie", "Buzón de voz"],
  "Gatekeeper": ["Barrage", "Filtro"],
  "Wants to talk again": ["Veut en reparler", "Quiere volver a hablar"],

  // ---- pipeline.ts
  "Talk again": ["À recontacter", "Volver a hablar"],
  "Met / demo": ["Rencontré / démo", "Reunión / demo"],
  "Proposal": ["Proposition", "Propuesta"],
  "No next action with a date": ["Pas de prochaine action datée", "Sin próxima acción con fecha"],
  "Next action overdue": ["Prochaine action en retard", "Próxima acción vencida"],
  "Qualified requires ANUM notes: missing {fields}": ["Qualifié demande les notes ANUM. Il manque : {fields}", "Cualificado requiere las notas ANUM. Falta: {fields}"],
  "authority": ["décideur", "autoridad"],
  "need": ["besoin", "necesidad"],
  "urgency": ["urgence", "urgencia"],
  "money": ["budget", "presupuesto"],
  "authority, need": ["décideur, besoin", "autoridad, necesidad"],
  "authority, urgency": ["décideur, urgence", "autoridad, urgencia"],
  "authority, money": ["décideur, budget", "autoridad, presupuesto"],
  "need, urgency": ["besoin, urgence", "necesidad, urgencia"],
  "need, money": ["besoin, budget", "necesidad, presupuesto"],
  "urgency, money": ["urgence, budget", "urgencia, presupuesto"],
  "authority, need, urgency": ["décideur, besoin, urgence", "autoridad, necesidad, urgencia"],
  "authority, need, money": ["décideur, besoin, budget", "autoridad, necesidad, presupuesto"],
  "authority, urgency, money": ["décideur, urgence, budget", "autoridad, urgencia, presupuesto"],
  "need, urgency, money": ["besoin, urgence, budget", "necesidad, urgencia, presupuesto"],
  "authority, need, urgency, money": ["décideur, besoin, urgence, budget", "autoridad, necesidad, urgencia, presupuesto"],
  "A lost reason is required": ["Une raison de perte est obligatoire", "Hace falta un motivo de pérdida"],
  // leadStatus values as words
  "Not called": ["Pas appelé", "Sin llamar"],
  "Refused": ["Refus", "Rechazo"],
  "Yes": ["Oui", "Sí"],
  "Opted out": ["Opposé", "Ha pedido no ser contactado"],

  // ---- objections.ts
  "Brush-off": ["Esquive", "Evasiva"],
  "Real objection": ["Vraie objection", "Objeción real"],
  "Label": ["Étiqueter", "Etiquetar"],
  "Ask": ["Demander", "Preguntar"],
  "Next step": ["Prochaine étape", "Siguiente paso"],
  "A reflex at the opener: they don't know yet what you offer. Don't argue, lower the pressure, ask one question.": [
    "Un réflexe à l'accroche : il ne sait pas encore ce que tu proposes. N'argumente pas, baisse la pression, pose une seule question.",
    "Un reflejo en la apertura: aún no sabe qué ofreces. No discutas, baja la presión y haz una sola pregunta.",
  ],
  "Usually a brush-off. Test it with a precise time: a real 'no time' gives you one.": [
    "Souvent une esquive. Teste avec un horaire précis : un vrai « pas le temps » t'en donne un.",
    "Suele ser una evasiva. Ponlo a prueba con una hora concreta: un «no tengo tiempo» real te da una.",
  ],
  "Often a polite exit. Ask what would make it worth it, send it now, fix the call-back.": [
    "Souvent une sortie polie. Demande ce qui rendrait ça intéressant, envoie-le tout de suite, fixe le rappel.",
    "A menudo es una salida educada. Pregunta qué haría que mereciera la pena, envíalo ya y fija la nueva llamada.",
  ],
  "Status quo. Find the gap: what would they like it to do better?": [
    "Statu quo. Trouve le manque : qu'aimerait-il que ça fasse mieux ?",
    "Statu quo. Encuentra la carencia: ¿qué le gustaría que hiciera mejor?",
  ],
  "Price without value. Bring the cost of doing nothing: one recovered job pays the month.": [
    "Un prix sans valeur. Montre le coût de l'inaction : un seul chantier récupéré paie le mois.",
    "Precio sin valor. Saca el coste de no hacer nada: un solo trabajo recuperado paga el mes.",
  ],
  "They don't see the problem yet. Make them count their missed calls.": [
    "Il ne voit pas encore le problème. Fais-lui compter ses appels manqués.",
    "Todavía no ve el problema. Haz que cuente sus llamadas perdidas.",
  ],
  "Common with trades. Move from 'more clients' to 'better clients, less hassle'.": [
    "Fréquent chez les artisans. Passe de « plus de clients » à « de meilleurs clients, moins de tracas ».",
    "Habitual en oficios. Pasa de «más clientes» a «mejores clientes, menos líos».",
  ],
  "Get the name, the best time to call, and a reason to pass the message on.": [
    "Obtiens le nom, le meilleur moment pour appeler et une raison de transmettre le message.",
    "Consigue el nombre, la mejor hora para llamar y un motivo para que pase el mensaje.",
  ],
  "Real or polite? Mirror it ('Not a good time?'), wait, then fix a date.": [
    "Vrai ou poli ? Reformule (« Pas le moment ? »), attends, puis fixe une date.",
    "¿Real o por educación? Repítelo («¿No es buen momento?»), espera y fija una fecha.",
  ],
  "Trust. Ask what went wrong, then show, don't promise.": [
    "Confiance. Demande ce qui s'est mal passé, puis montre, ne promets pas.",
    "Confianza. Pregunta qué salió mal y luego enseña, no prometas.",
  ],
  "Something is missing. Ask what, with a 1-to-10 scale.": [
    "Il manque quelque chose. Demande quoi, avec une échelle de 1 à 10.",
    "Falta algo. Pregunta qué, con una escala del 1 al 10.",
  ],
  "Ask what would make them say yes.": ["Demande ce qui le ferait dire oui.", "Pregunta qué le haría decir que sí."],

  // ---- playbook.ts
  "Email + Calendly": ["Email + Calendly", "Email + Calendly"],
  "Send the deck": ["Envoyer la présentation", "Enviar la presentación"],
  "Thank you for the call": ["Merci pour l'appel", "Gracias por la llamada"],
  "Book a call (Calendly)": ["Réserver un appel (Calendly)", "Reservar una llamada (Calendly)"],
  "Commercial deck": ["Présentation commerciale", "Presentación comercial"],
  "Meeting confirmation": ["Confirmation de RDV", "Confirmación de la reunión"],
  "Thank you, door open (after a no)": ["Merci, porte ouverte (après un non)", "Gracias, puerta abierta (tras un no)"],
  "Tried to reach you (no answer)": ["J'ai essayé de vous joindre (pas de réponse)", "He intentado llamarle (sin respuesta)"],
  "Nudge (no reply yet)": ["Relance (pas encore de réponse)", "Recordatorio (aún sin respuesta)"],
  "Thanks": ["Merci", "Gracias"],
  "Deck": ["Présentation", "Presentación"],
  "Confirm": ["Confirmer", "Confirmar"],
  "Thanks (no)": ["Merci (non)", "Gracias (no)"],
  "Missed you": ["Manqué", "Sin respuesta"],
  "Nudge": ["Relance", "Recordatorio"],
  "{objection} · reply {n}": ["{objection} · réponse {n}", "{objection} · respuesta {n}"],
  "[add your Calendly link in Settings › Workspace]": ["[ajoute ton lien Calendly dans Réglages › Espace de travail]", "[añade tu enlace de Calendly en Ajustes › Espacio de trabajo]"],
  "[add the deck link in Settings › Workspace]": ["[ajoute le lien de la présentation dans Réglages › Espace de travail]", "[añade el enlace de la presentación en Ajustes › Espacio de trabajo]"],

  // ---- bank.ts CATEGORY_LABELS
  "Client revenue": ["Chiffre d'affaires client", "Ingresos de clientes"],
  "Founder contribution": ["Apport des fondateurs", "Aportación de los socios"],
  "Transfer between our balances": ["Virement entre nos comptes", "Traspaso entre nuestros saldos"],
  "Other income": ["Autres entrées", "Otros ingresos"],
  "Software & tools": ["Logiciels et outils", "Software y herramientas"],
  "Advertising": ["Publicité", "Publicidad"],
  "Contractors": ["Prestataires", "Colaboradores externos"],
  "Phone & internet": ["Téléphone et internet", "Teléfono e internet"],
  "Travel": ["Déplacements", "Desplazamientos"],
  "Bank fees": ["Frais bancaires", "Comisiones bancarias"],
  "Taxes": ["Impôts et taxes", "Impuestos"],
  "Salaries": ["Salaires", "Salarios"],
  "Other expense": ["Autre dépense", "Otro gasto"],
  "Row {n}: missing ID, date or amount": ["Ligne {n} : ID, date ou montant manquant", "Fila {n}: falta el ID, la fecha o el importe"],

  // ---- funnels.ts
  "Cold calls": ["Appels de prospection", "Llamadas en frío"],
  "LinkedIn": ["LinkedIn", "LinkedIn"],
  "Email": ["Email", "Email"],
  "WhatsApp": ["WhatsApp", "WhatsApp"],
  "Website & social": ["Site web et réseaux", "Web y redes sociales"],
  "Dials": ["Appels", "Llamadas"],
  "Picked up": ["Décrochés", "Contestadas"],
  "Said yes": ["Oui", "Sí"],
  "Visits": ["Visites", "Visitas"],
  "Invitations & messages": ["Invitations et messages", "Invitaciones y mensajes"],
  "People reached": ["Personnes touchées", "Personas alcanzadas"],
  "Replies": ["Réponses", "Respuestas"],
  "Leads": ["Prospects", "Prospectos"],
  "Purchases": ["Achats", "Compras"],
  "Meetings": ["RDV", "Reuniones"],
  "Best return on time: {channel} ({n} meetings per hour of work).": [
    "Meilleur rendement du temps : {channel} ({n} RDV par heure de travail).",
    "Mejor rendimiento del tiempo: {channel} ({n} reuniones por hora de trabajo).",
  ],
  "{channel}: {n} touches and no meeting yet. Change the message or the target.": [
    "{channel} : {n} contacts et toujours aucun RDV. Change le message ou la cible.",
    "{channel}: {n} contactos y aún ninguna reunión. Cambia el mensaje o el objetivo.",
  ],
  "No meeting in this period yet: keep volume up on the channel with the most replies.": [
    "Aucun RDV sur cette période pour l'instant : garde le volume sur le canal qui a le plus de réponses.",
    "Aún ninguna reunión en este periodo: mantén el volumen en el canal con más respuestas.",
  ],

  // ---- content.ts DELIVERABLE_LABELS
  "Video concepts": ["Concepts vidéo", "Conceptos de vídeo"],
  "Reels": ["Reels", "Reels"],
  "Brand LinkedIn posts": ["Posts LinkedIn de la marque", "Publicaciones de LinkedIn de la marca"],
  "Personal LinkedIn posts": ["Posts LinkedIn perso", "Publicaciones personales de LinkedIn"],
  "Instagram stories": ["Stories Instagram", "Historias de Instagram"],
  "VSL (every 2 weeks)": ["VSL (toutes les 2 semaines)", "VSL (cada 2 semanas)"],

  // ---- marketing.ts (domain)
  "Unknown": ["Inconnu", "Desconocido"],
  "No Sessions column found.": ["Aucune colonne Sessions trouvée.", "No se ha encontrado ninguna columna Sesiones."],
  "{account}: only {pct}% of the audience is in {markets}": ["{account} : seulement {pct} % de l'audience est en {markets}", "{account}: solo el {pct} % de la audiencia está en {markets}"],
  "Top countries: {list}": ["Pays principaux : {list}", "Países principales: {list}"],
  "Post in the language of your target market and use local hashtags and places; avoid content that travels outside {markets}.": [
    "Publie dans la langue de ton marché cible avec des hashtags et des lieux locaux ; évite les contenus qui partent hors de {markets}.",
    "Publica en el idioma de tu mercado objetivo con hashtags y lugares locales; evita contenido que se vaya fuera de {markets}.",
  ],
  "{account}: {pct}% of the audience is in your target markets": ["{account} : {pct} % de l'audience est sur tes marchés cibles", "{account}: el {pct} % de la audiencia está en tus mercados objetivo"],
  "Keep the current targeting.": ["Garde le ciblage actuel.", "Mantén la segmentación actual."],
  "{account}: {market} is under-reached ({pct}% of the audience)": ["{account} : {market} est peu touché ({pct} % de l'audience)", "{account}: {market} tiene poco alcance ({pct} % de la audiencia)"],
  "{a} and {b} are both target markets": ["{a} et {b} sont tous deux des marchés cibles", "{a} y {b} son ambos mercados objetivo"],
  "Publish more Spanish versions and ask the Spanish founder to share them.": [
    "Publie plus de versions en espagnol et demande au fondateur espagnol de les partager.",
    "Publica más versiones en español y pide al socio español que las comparta.",
  ],
  "Publish more French versions and ask the French founder to share them.": [
    "Publie plus de versions en français et demande au fondateur français de les partager.",
    "Publica más versiones en francés y pide al socio francés que las comparta.",
  ],
  "{source} / {medium} converts best": ["{source} / {medium} convertit le mieux", "{source} / {medium} es lo que mejor convierte"],
  "{rate}% of sessions convert vs {avg}% on average ({n} sessions)": ["{rate} % des sessions convertissent contre {avg} % en moyenne ({n} sessions)", "Convierte el {rate} % de las sesiones frente al {avg} % de media ({n} sesiones)"],
  "Put more of next week's content effort into {source}.": ["Mets plus d'effort de contenu sur {source} la semaine prochaine.", "Dedica más esfuerzo de contenido a {source} la semana que viene."],
  "{source} brings visits but no leads": ["{source} apporte des visites mais aucun prospect", "{source} trae visitas pero ningún prospecto"],
  "{n} sessions, 0 leads or purchases": ["{n} sessions, 0 prospect ni achat", "{n} sesiones, 0 prospectos o compras"],
  "Check the link destination, the call to action and the form for this source.": [
    "Vérifie la destination du lien, l'appel à l'action et le formulaire pour cette source.",
    "Revisa el destino del enlace, la llamada a la acción y el formulario de esta fuente.",
  ],
  "No traffic data yet": ["Pas encore de données de trafic", "Aún no hay datos de tráfico"],
  "Sources and conversions are unknown": ["Sources et conversions inconnues", "Fuentes y conversiones desconocidas"],
  "Import a GA4 export (Reports › Acquisition › Traffic acquisition, CSV) or enter this week's numbers.": [
    "Importe un export GA4 (Rapports › Acquisition › Acquisition de trafic, CSV) ou saisis les chiffres de la semaine.",
    "Importa una exportación de GA4 (Informes › Adquisición › Adquisición de tráfico, CSV) o introduce las cifras de esta semana.",
  ],
  "{label}: {done}/{target} this week": ["{label} : {done}/{target} cette semaine", "{label}: {done}/{target} esta semana"],
  "Weekly content target": ["Objectif de contenu hebdomadaire", "Objetivo de contenido semanal"],
  "Schedule the missing pieces before Friday.": ["Planifie les contenus manquants avant vendredi.", "Programa las piezas que faltan antes del viernes."],

  // ---- nba.ts TIER_LABEL
  "Replied, waiting for you": ["A répondu, attend ta réponse", "Ha respondido, te está esperando"],
  "High-priority follow-up overdue": ["Relance prioritaire en retard", "Seguimiento prioritario vencido"],
  "Follow-up due": ["Relance à faire", "Seguimiento pendiente"],
  "Hot lead going cold": ["Prospect chaud qui refroidit", "Prospecto caliente que se enfría"],
  "New target in the sprint niche": ["Nouvelle cible dans la niche du sprint", "Nuevo objetivo en el nicho del sprint"],

  // ---- email.ts EXTERNAL_BENCHMARKS + weekdays
  "Typical B2B cold email": ["Email de prospection B2B typique", "Email en frío B2B típico"],
  "Strong: small, well-targeted lists": ["Bon : petites listes bien ciblées", "Bueno: listas pequeñas y bien segmentadas"],
  "Instantly, Cold Email Benchmark 2026 (3.43% average reply rate)": ["Instantly, Cold Email Benchmark 2026 (3,43 % de taux de réponse moyen)", "Instantly, Cold Email Benchmark 2026 (3,43 % de tasa media de respuesta)"],
  "Leadsforge, B2B cold email benchmarks (1–3% typical, 3–5% strong, 5–8%+ top)": ["Leadsforge, repères d'emails de prospection B2B (1–3 % typique, 3–5 % bon, 5–8 %+ excellent)", "Leadsforge, referencias de email en frío B2B (1–3 % típico, 3–5 % bueno, 5–8 %+ excelente)"],
  "Saleshandy, cold email statistics (5.8% for sends under 50 recipients vs 2.1% above)": ["Saleshandy, statistiques d'emails de prospection (5,8 % sous 50 destinataires contre 2,1 % au-delà)", "Saleshandy, estadísticas de email en frío (5,8 % con menos de 50 destinatarios frente a 2,1 % por encima)"],
  "Belkins, cold email response rates by industry": ["Belkins, taux de réponse des emails de prospection par secteur", "Belkins, tasas de respuesta de email en frío por sector"],
  "Apollo, reply-rate benchmarks for cold outreach (3–6% healthy)": ["Apollo, repères de taux de réponse en prospection (3–6 % sain)", "Apollo, referencias de tasa de respuesta en prospección (3–6 % saludable)"],
  "Sun": ["dim.", "dom."],
  "Mon": ["lun.", "lun."],
  "Tue": ["mar.", "mar."],
  "Wed": ["mer.", "mié."],
  "Thu": ["jeu.", "jue."],
  "Fri": ["ven.", "vie."],
  "Sat": ["sam.", "sáb."],

  // ---- dashboard.ts
  "Unknown trade": ["Métier inconnu", "Oficio desconocido"],
  "Free dialling": ["Appels libres", "Llamadas libres"],

  // ---- suppression.ts reasons
  "This contact opted out.": ["Ce contact s'est opposé à être contacté.", "Este contacto ha pedido no ser contactado."],
  "This contact is on the suppression list.": ["Ce contact est sur la liste d'exclusion.", "Este contacto está en la lista de exclusión."],
  "This business is on the suppression list.": ["Cette entreprise est sur la liste d'exclusion.", "Esta empresa está en la lista de exclusión."],
  "This email address is on the suppression list.": ["Cette adresse email est sur la liste d'exclusion.", "Esta dirección de email está en la lista de exclusión."],
  "This phone number is on the suppression list.": ["Ce numéro de téléphone est sur la liste d'exclusion.", "Este número de teléfono está en la lista de exclusión."],
  "This business domain is on the suppression list.": ["Ce domaine d'entreprise est sur la liste d'exclusion.", "Este dominio de empresa está en la lista de exclusión."],

  // ---- csv.ts import
  "Company is required": ["L'entreprise est obligatoire", "La empresa es obligatoria"],
  "Invalid email": ["Email invalide", "Email no válido"],
  "company: Company is required": ["entreprise : l'entreprise est obligatoire", "empresa: la empresa es obligatoria"],
  "email: Invalid email": ["email : email invalide", "email: email no válido"],
  "File too large (max {n} MB)": ["Fichier trop volumineux (max {n} Mo)", "Archivo demasiado grande (máx. {n} MB)"],
  "Too many rows (max {n})": ["Trop de lignes (max {n})", "Demasiadas filas (máx. {n})"],

  // ---- seeds.ts channel-rule notes
  "Prior consent required since 2026-08-11 (loi 2025-594); consent evidence must be retained.": [
    "Consentement préalable obligatoire depuis le 2026-08-11 (loi 2025-594) ; la preuve du consentement doit être conservée.",
    "Consentimiento previo obligatorio desde el 2026-08-11 (ley francesa 2025-594); hay que conservar la prueba del consentimiento.",
  ],
  "Reported as outside the consumer consent rule when the offer directly relates to the recipient's profession; confirm treatment of sole traders.": [
    "Considéré comme hors de la règle de consentement des particuliers quand l'offre est directement liée au métier du destinataire ; confirmer le cas des indépendants.",
    "Se considera fuera de la norma de consentimiento de particulares cuando la oferta está directamente relacionada con la profesión del destinatario; confirmar el caso de los autónomos.",
  ],
  "Opt-out regime when relevant to the recipient's role; sender identity and a way to object on every message.": [
    "Régime d'opposition (opt-out) si c'est pertinent pour la fonction du destinataire ; identité de l'expéditeur et moyen de s'opposer dans chaque message.",
    "Régimen de exclusión voluntaria (opt-out) si es pertinente para el puesto del destinatario; identidad del remitente y forma de oponerse en cada mensaje.",
  ],
  "LSSI art. 21 requires prior authorization or a prior relationship, not limited to consumers. Treat Spanish cold email as requires_consent until reviewed.": [
    "L'art. 21 de la LSSI exige une autorisation préalable ou une relation antérieure, pas seulement pour les particuliers. Traiter l'email de prospection en Espagne comme « consentement requis » jusqu'à vérification.",
    "El art. 21 de la LSSI exige autorización previa o una relación previa, no solo con particulares. Tratar el email en frío en España como «requiere consentimiento» hasta su revisión.",
  ],
  "LGTel art. 66.1.b requires consent or another GDPR art. 6 basis; sole-trader treatment needs review.": [
    "L'art. 66.1.b de la LGTel exige le consentement ou une autre base de l'art. 6 du RGPD ; le cas des indépendants est à vérifier.",
    "El art. 66.1.b de la LGTel exige consentimiento u otra base del art. 6 del RGPD; el caso de los autónomos está por revisar.",
  ],

  // ---- seeds.ts SETTINGS_SEEDS + settings/system KEYS (hints)
  "Follow-up cadence seed (day 14 = close-the-file message). Creates next actions only, never sends.": [
    "Cadence de relance de départ (jour 14 = message de clôture). Crée seulement les prochaines actions, n'envoie jamais rien.",
    "Cadencia de seguimiento inicial (día 14 = mensaje de cierre). Solo crea próximas acciones, nunca envía nada.",
  ],
  "Flag inactive prospects for deletion after this many years since last contact.": [
    "Signaler les prospects inactifs à supprimer après ce nombre d'années sans contact.",
    "Marcar para borrar los prospectos inactivos tras este número de años sin contacto.",
  ],
  "Remaining monthly InMail credits (manual resets and credits).": [
    "Crédits InMail restants ce mois-ci (remises à zéro et crédits manuels).",
    "Créditos de InMail restantes este mes (reinicios y créditos manuales).",
  ],
  "Hot leads with no touch for N days enter the Next Best Action queue.": [
    "Les prospects chauds sans contact depuis N jours entrent dans la file des prochaines meilleures actions.",
    "Los prospectos calientes sin contacto durante N días entran en la cola de próximas mejores acciones.",
  ],
  "Legal company name (entered by a founder; never invented).": [
    "Raison sociale (saisie par un fondateur ; jamais inventée).",
    "Razón social (la introduce un socio; nunca se inventa).",
  ],
  "Drive folder shared with the service account (Viewer).": [
    "Dossier Drive partagé avec le compte de service (lecteur).",
    "Carpeta de Drive compartida con la cuenta de servicio (lector).",
  ],
  "Standing video link inserted in founder point events.": [
    "Lien visio permanent ajouté aux événements du point fondateurs.",
    "Enlace de videollamada fijo que se añade a los eventos de la reunión de socios.",
  ],
  "Max ideas in Testing while a sprint is active.": [
    "Nombre max d'idées en test pendant un sprint actif.",
    "Máximo de ideas en prueba mientras hay un sprint activo.",
  ],
  "Minimum attempts before conversion rates are shown.": [
    "Nombre minimum de tentatives avant d'afficher les taux de conversion.",
    "Mínimo de intentos antes de mostrar las tasas de conversión.",
  ],
  "Théo's booking link inserted in call follow-ups.": [
    "Lien de réservation de Théo ajouté aux relances après appel.",
    "Enlace de reservas de Théo que se añade a los seguimientos de llamada.",
  ],
  "Pablo's booking link inserted in call follow-ups.": [
    "Lien de réservation de Pablo ajouté aux relances après appel.",
    "Enlace de reservas de Pablo que se añade a los seguimientos de llamada.",
  ],
  "Commercial deck link (French).": ["Lien de la présentation commerciale (français).", "Enlace de la presentación comercial (francés)."],
  "Commercial deck link (Spanish).": ["Lien de la présentation commerciale (espagnol).", "Enlace de la presentación comercial (español)."],
};
