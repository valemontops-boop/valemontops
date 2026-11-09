import type { Objection } from "./constants";

/**
 * Objection playbook (founder feedback round 4), built on what call research converges on:
 * 1. Diagnose first: a brush-off (reflex, said to end the call) needs a light touch and one question;
 *    a real objection needs the reason explored before any answer.
 * 2. Pause before answering, then label what you heard instead of arguing ("On dirait que…").
 * 3. Ask an open, calibrated question ("Qu'est-ce qui…", "Comment…") rather than pitching.
 * 4. Always end on a small, concrete next step (15 minutes, a call-back date, the deck now).
 * Each objection has two reply variants per language; call mode tracks which one was used and how
 * often the call still ended in a yes, then shows the best one first.
 * Reply format: three lines, Label / Ask / Next step. Founders can rewrite them in Settings › Playbook.
 */
export type ObjectionType = "brush_off" | "real";
export interface ObjectionInfo { key: Objection; type: ObjectionType; hotkey: string; meaning: string; say: { FR: string; ES: string } }

/** Live objections in key order. Letters avoid the call-mode action keys (E, P, W, C, N, M). */
export const OBJECTION_GUIDE: ObjectionInfo[] = [
  { key: "not_interested", type: "brush_off", hotkey: "a", meaning: "A reflex at the opener: they don't know yet what you offer. Don't argue, lower the pressure, ask one question.", say: { FR: "Ça ne m'intéresse pas.", ES: "No me interesa." } },
  { key: "no_time", type: "brush_off", hotkey: "s", meaning: "Usually a brush-off. Test it with a precise time: a real 'no time' gives you one.", say: { FR: "Je n'ai pas le temps, là.", ES: "Ahora no tengo tiempo." } },
  { key: "send_info", type: "brush_off", hotkey: "d", meaning: "Often a polite exit. Ask what would make it worth it, send it now, fix the call-back.", say: { FR: "Envoyez-moi un mail.", ES: "Mándeme un email." } },
  { key: "already_has_solution", type: "brush_off", hotkey: "f", meaning: "Status quo. Find the gap: what would they like it to do better?", say: { FR: "On a déjà quelqu'un pour ça.", ES: "Ya tenemos a alguien para eso." } },
  { key: "too_expensive", type: "real", hotkey: "g", meaning: "Price without value. Bring the cost of doing nothing: one recovered job pays the month.", say: { FR: "C'est trop cher pour moi.", ES: "Es demasiado caro para mí." } },
  { key: "no_need", type: "real", hotkey: "h", meaning: "They don't see the problem yet. Make them count their missed calls.", say: { FR: "Je n'en ai pas besoin.", ES: "No lo necesito." } },
  { key: "enough_work", type: "real", hotkey: "j", meaning: "Common with trades. Move from 'more clients' to 'better clients, less hassle'.", say: { FR: "J'ai déjà assez de boulot.", ES: "Ya tengo bastante trabajo." } },
  { key: "not_decision_maker", type: "real", hotkey: "k", meaning: "Get the name, the best time to call, and a reason to pass the message on.", say: { FR: "Ce n'est pas moi qui décide.", ES: "No soy yo quien decide." } },
  { key: "bad_timing", type: "real", hotkey: "l", meaning: "Real or polite? Mirror it ('Not a good time?'), wait, then fix a date.", say: { FR: "Ce n'est pas le moment.", ES: "No es buen momento." } },
  { key: "bad_experience", type: "real", hotkey: "q", meaning: "Trust. Ask what went wrong, then show, don't promise.", say: { FR: "On s'est déjà fait avoir avec ce genre de truc.", ES: "Ya nos engañaron con algo así." } },
  { key: "think_about_it", type: "real", hotkey: "r", meaning: "Something is missing. Ask what, with a 1-to-10 scale.", say: { FR: "Je vais réfléchir.", ES: "Me lo pienso." } },
  { key: "other", type: "real", hotkey: "t", meaning: "Ask what would make them say yes.", say: { FR: "Non, merci.", ES: "No, gracias." } },
];
export const OBJECTION_TYPE_LABEL: Record<ObjectionType, string> = { brush_off: "Brush-off", real: "Real objection" };
export const guideOf = (k: string) => OBJECTION_GUIDE.find((g) => g.key === k) ?? null;
/**
 * The live objection list (round 10, D076): every objection visible at once, in two groups (brush-offs, then real
 * objections), each group in the given order (the founder's most frequent first). Unknown keys are dropped.
 */
export function objectionGroups(order: readonly string[]): { type: ObjectionType; keys: Objection[] }[] {
  const known = [...new Set(order)].map(guideOf).filter((g): g is ObjectionInfo => Boolean(g));
  const rest = OBJECTION_GUIDE.filter((g) => !known.includes(g));
  const all = [...known, ...rest];
  return (["brush_off", "real"] as const).map((type) => ({ type, keys: all.filter((g) => g.type === type).map((g) => g.key) }));
}
export const REPLY_STEPS = ["Label", "Ask", "Next step"] as const;
export const VARIANTS = 2;

type R = [string, string, string];
/** [objection, FR variants, ES variants] */
const REPLIES: [Objection, R[], R[]][] = [
  ["not_interested",
    [["On dirait que je tombe mal, et vous recevez sûrement beaucoup d'appels comme le mien.", "Juste une question : quand vous êtes sur un chantier, qu'est-ce qui se passe avec les appels que vous ratez ?", "Si c'est un vrai sujet, 15 minutes pour vous montrer ; sinon je ne vous rappelle plus. Ça vous va ?"],
     ["Pas de souci, je ne vais pas vous retenir.", "Ce serait idiot de vous demander combien de demandes vous perdez par semaine ?", "Si c'est plus de deux, ça vaut 15 minutes. Plutôt mardi ou jeudi ?"]],
    [["Parece que le pillo en mal momento, y seguro que recibe muchas llamadas como esta.", "Solo una cosa: cuando está trabajando, ¿qué pasa con las llamadas que no puede coger?", "Si es un problema real, 15 minutos para enseñárselo; si no, no le vuelvo a llamar. ¿Le parece?"],
     ["Sin problema, no le entretengo.", "¿Sería una tontería preguntarle cuántas solicitudes pierde a la semana?", "Si son más de dos, merece 15 minutos. ¿Martes o jueves?"]]],
  ["no_time",
    [["Je sens que vous êtes en plein boulot.", "Quel serait le meilleur moment pour 2 minutes : ce soir ou demain matin ?", "Je le note et je vous rappelle à l'heure pile."],
     ["C'est justement parce que vous n'avez pas le temps que je vous appelle.", "Qui répond à vos clients quand vous êtes occupé comme maintenant ?", "Je vous envoie mon lien par message : vous choisissez 15 minutes quand ça vous arrange."]],
    [["Le noto muy liado.", "¿Cuál sería el mejor momento para 2 minutos: esta tarde o mañana por la mañana?", "Lo apunto y le llamo a esa hora exacta."],
     ["Le llamo precisamente porque no tiene tiempo.", "¿Quién atiende a sus clientes cuando está ocupado como ahora?", "Le mando mi enlace por mensaje y elige 15 minutos cuando le venga bien."]]],
  ["send_info",
    [["Avec plaisir, je vous envoie ça.", "Pour vous envoyer le bon exemple : ce sont plutôt les appels manqués ou les devis sans réponse qui vous coûtent ?", "Je vous l'envoie maintenant et je vous rappelle jeudi pour avoir votre avis. Ça marche ?"],
     ["Bien sûr. Souvent, un mail finit au fond de la boîte.", "Qu'est-ce qui ferait que ça vaille 15 minutes pour vous ?", "Je mets mon lien dans le mail : vous choisissez le créneau."]],
    [["Con mucho gusto, se lo mando.", "Para mandarle el ejemplo correcto: ¿le cuestan más las llamadas perdidas o los presupuestos sin respuesta?", "Se lo mando ahora y le llamo el jueves para saber qué le parece. ¿Le va bien?"],
     ["Claro. Muchas veces un email acaba en el fondo del buzón.", "¿Qué haría que valieran la pena 15 minutos para usted?", "Le pongo mi enlace en el email y elige el horario."]]],
  ["already_has_solution",
    [["Très bien, ça veut dire que le sujet compte pour vous.", "Qu'est-ce que vous aimeriez qu'il fasse mieux ?", "Je vous montre en 15 minutes ce qu'on fait en plus ; si ce n'est pas mieux, vous gardez le vôtre."],
     ["Parfait.", "Il relance aussi les devis et demande l'avis Google après l'intervention ?", "Si ce n'est pas le cas, 15 minutes suffisent pour comparer. Mardi ou jeudi ?"]],
    [["Muy bien, eso significa que el tema le importa.", "¿Qué le gustaría que hiciera mejor?", "Le enseño en 15 minutos lo que hacemos además; si no es mejor, se queda con el suyo."],
     ["Perfecto.", "¿También hace seguimiento de los presupuestos y pide la reseña en Google después del trabajo?", "Si no, con 15 minutos lo comparamos. ¿Martes o jueves?"]]],
  ["too_expensive",
    [["On dirait que le prix vous freine avant même de voir ce que ça rapporte.", "Combien vous rapporte un chantier moyen ?", "Quelques clients récupérés suffisent à rembourser l'investissement. On regarde vos chiffres ensemble en 15 minutes ?"],
     ["C'est normal de faire attention à chaque euro.", "Trop cher par rapport à quoi : votre budget, ou ce que vous perdez aujourd'hui ?", "Je vous montre le calcul avec vos chiffres ; si ça ne tient pas, je vous le dirai moi-même."]],
    [["Parece que el precio le frena antes de ver lo que le aporta.", "¿Cuánto le deja un trabajo medio?", "Unos pocos clientes recuperados bastan para amortizar la inversión. ¿Lo miramos con sus números en 15 minutos?"],
     ["Es normal mirar cada euro.", "¿Caro comparado con qué: su presupuesto, o lo que pierde hoy?", "Le enseño el cálculo con sus números; si no sale, se lo diré yo mismo."]]],
  ["no_need",
    [["Ça a l'air de bien tourner pour vous.", "Combien d'appels vous ratez par semaine, à votre avis ?", "Si c'est zéro, je vous laisse tranquille. Sinon, 15 minutes pour voir ce que ça vous coûte."],
     ["Vous avez sûrement déjà votre organisation.", "Comment vous gérez une demande qui arrive un samedi soir ?", "Si la réponse vous plaît, parfait. Sinon, je vous montre comment d'autres artisans font."]],
    [["Parece que le va bien.", "¿Cuántas llamadas pierde a la semana, más o menos?", "Si son cero, no le molesto más. Si no, 15 minutos para ver lo que le cuesta."],
     ["Seguro que ya tiene su organización.", "¿Cómo gestiona una solicitud que llega un sábado por la noche?", "Si le convence su respuesta, perfecto. Si no, le enseño cómo lo hacen otros profesionales."]]],
  ["enough_work",
    [["Bonne nouvelle, vous êtes demandé.", "Vous choisissez vos chantiers ou vous prenez ce qui arrive ?", "Le système trie les demandes pour garder les plus rentables. Je vous montre en 15 minutes ?"],
     ["Quand on est plein, chaque appel en plus dérange.", "Qui répond pour dire non poliment et garder le client pour plus tard ?", "C'est exactement ce qu'on automatise. 15 minutes cette semaine ?"]],
    [["Buena señal, tiene demanda.", "¿Elige sus trabajos o acepta lo que llega?", "El sistema filtra las solicitudes para quedarse con las más rentables. ¿Se lo enseño en 15 minutos?"],
     ["Cuando se está lleno, cada llamada de más molesta.", "¿Quién contesta para decir que no con educación y guardar el cliente para más adelante?", "Eso es justo lo que automatizamos. ¿15 minutos esta semana?"]]],
  ["not_decision_maker",
    [["Merci, je ne veux pas vous faire perdre de temps.", "Qui s'occupe de ça chez vous ?", "Quel est le meilleur moment pour le joindre ? Je le note."],
     ["D'accord.", "Si ça vous paraît utile, comment on en parle avec lui ?", "Je vous envoie un résumé à lui transmettre et je le rappelle jeudi. C'est quoi son prénom ?"]],
    [["Gracias, no quiero hacerle perder el tiempo.", "¿Quién se encarga de esto?", "¿Cuándo es mejor llamarle? Lo apunto."],
     ["De acuerdo.", "Si le parece útil, ¿cómo lo hablamos con él?", "Le mando un resumen para que se lo pase y le llamo el jueves. ¿Cómo se llama?"]]],
  ["bad_timing",
    [["Ce n'est pas le moment, je comprends.", "Qu'est-ce qui aura changé d'ici là ?", "Je vous rappelle à quelle date ? Je la note tout de suite."],
     ["Pas le moment ? (Laissez un silence.)", "C'est plutôt la saison, ou autre chose ?", "Je vous envoie mon lien : on cale 15 minutes quand ça se calme."]],
    [["No es el momento, lo entiendo.", "¿Qué habrá cambiado de aquí a entonces?", "¿Qué día le vuelvo a llamar? Lo apunto ahora mismo."],
     ["¿No es buen momento? (Deje un silencio.)", "¿Es por la temporada, o por otra cosa?", "Le mando mi enlace: reservamos 15 minutos cuando se calme."]]],
  ["bad_experience",
    [["On dirait que vous vous êtes déjà fait avoir.", "Qu'est-ce qui n'avait pas marché ?", "Je vous montre la démo en vrai et tout est écrit dans le devis : vous jugez sur pièces. 15 minutes ?"],
     ["C'est sain d'être méfiant.", "Qu'est-ce qu'il faudrait voir pour être rassuré ?", "Je vous le montre en 15 minutes, sans rien signer. Mardi ou jeudi ?"]],
    [["Parece que ya le han engañado alguna vez.", "¿Qué fue lo que no funcionó?", "Le enseño la demo real y todo queda por escrito en el presupuesto: juzgue usted. ¿15 minutos?"],
     ["Es sano desconfiar.", "¿Qué tendría que ver para quedarse tranquilo?", "Se lo enseño en 15 minutos, sin firmar nada. ¿Martes o jueves?"]]],
  ["think_about_it",
    [["C'est normal d'y réfléchir.", "Qu'est-ce qui vous fait hésiter ?", "Je vous envoie le résumé et je vous rappelle jeudi pour en parler."],
     ["Souvent, « je vais réfléchir » veut dire qu'il manque quelque chose.", "De 1 à 10, vous en êtes où ? Qu'est-ce qui manque pour arriver à 10 ?", "On cale 10 minutes pour régler ce point. Mardi ?"]],
    [["Es normal pensarlo.", "¿Qué le hace dudar?", "Le mando el resumen y le llamo el jueves para hablarlo."],
     ["Muchas veces «me lo pienso» quiere decir que falta algo.", "Del 1 al 10, ¿dónde está? ¿Qué falta para llegar a 10?", "Reservamos 10 minutos para resolverlo. ¿El martes?"]]],
  ["other",
    [["Je vous entends.", "Qu'est-ce qui vous ferait dire oui ?", "Je le note et je reviens vers vous avec une réponse précise."],
     ["D'accord.", "À ma place, qu'est-ce que vous proposeriez ?", "Je vous envoie un message avec ce qu'on s'est dit."]],
    [["Le entiendo.", "¿Qué le haría decir que sí?", "Lo apunto y le vuelvo a llamar con una respuesta concreta."],
     ["De acuerdo.", "En mi lugar, ¿qué propondría usted?", "Le mando un mensaje con lo que hemos hablado."]]],
];

/** Playbook items for objection replies: key `objection#n`, body = the three lines. */
export function objectionDefaults() {
  const out: { kind: "objection"; key: string; language: "FR" | "ES"; subject: string; body: string }[] = [];
  for (const [k, fr, es] of REPLIES) {
    fr.forEach((r, i) => out.push({ kind: "objection", key: `${k}#${i + 1}`, language: "FR", subject: "", body: r.join("\n") }));
    es.forEach((r, i) => out.push({ kind: "objection", key: `${k}#${i + 1}`, language: "ES", subject: "", body: r.join("\n") }));
  }
  return out;
}

export interface VariantStat { reply: string; uses: number; won: number }
/** Uses and wins per reply variant ("too_expensive#2"), from calls that recorded which reply was used. */
export function replyStats(events: { activity_type: string; outcome: string | null; replies?: string[] | null }[]): VariantStat[] {
  const m = new Map<string, VariantStat>();
  for (const e of events) {
    if (e.activity_type !== "connected_call") continue;
    const won = ["interested", "meeting_booked", "callback_requested"].includes(e.outcome ?? "");
    for (const r of e.replies ?? []) {
      const s = m.get(r) ?? { reply: r, uses: 0, won: 0 };
      s.uses++;
      if (won) s.won++;
      m.set(r, s);
    }
  }
  return [...m.values()].sort((a, b) => a.reply.localeCompare(b.reply));
}

/**
 * Which variant to show first: while any variant has fewer than `minUses` uses, the least used one
 * (so both get tried); after that, the best smoothed win rate.
 */
export function pickVariant(objection: string, stats: VariantStat[], variants = VARIANTS, minUses = 5): number {
  const s = Array.from({ length: variants }, (_, i) => stats.find((x) => x.reply === `${objection}#${i + 1}`) ?? { reply: `${objection}#${i + 1}`, uses: 0, won: 0 });
  const under = s.filter((x) => x.uses < minUses);
  if (under.length) return s.indexOf(under.sort((a, b) => a.uses - b.uses)[0]) + 1;
  const score = (x: VariantStat) => (x.won + 1) / (x.uses + 2);
  return s.indexOf([...s].sort((a, b) => score(b) - score(a))[0]) + 1;
}

/** Splits a reply into its three steps (extra lines join the last step). */
export function replySteps(body: string): string[] {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 3) return lines;
  return [lines[0], lines[1], lines.slice(2).join(" ")];
}
