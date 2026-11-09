/** usd12. English key → [FR, ES]. D085: USD only to pay contractors (Wise payment rate, Wise rate of the day, manual rate). */
export const entries: Record<string, readonly [string, string]> = {
  // rate labels and amounts
  "rate of the Wise payment of {d}": ["taux réel du paiement Wise du {d}", "tipo real del pago Wise del {d}"],
  "Wise rate of {d}": ["taux Wise du {d}", "tipo Wise del {d}"],
  "manual rate of {d}": ["taux manuel du {d}", "tipo manual del {d}"],
  "demo rate": ["taux démo", "tipo demo"],
  "rate missing, left out of EUR totals": ["taux manquant, hors totaux en €", "tipo pendiente, fuera de los totales en €"],
  "1 $US = {r} € ({src})": ["1 $US = {r} € ({src})", "1 $US = {r} € ({src})"],
  "No USD rate: enter one below, or connect Wise.": ["Aucun taux dollar : saisis-en un ci-dessous, ou connecte Wise.", "Ningún tipo de cambio del dólar: introduce uno abajo o conecta Wise."],
  "Manual rate: € for 1 $US": ["Taux manuel : € pour 1 $US", "Tipo manual: € por 1 $US"],
  "Rate date": ["Date du taux", "Fecha del tipo"],
  // Money: manual entries and the USD panel
  "Amounts in US dollars, ex VAT: converted to euros at the rate shown, locked at entry.": ["Montants en dollars US, hors TVA : convertis en euros au taux affiché, figé à la saisie.", "Importes en dólares EE. UU., sin IVA: convertidos a euros al tipo indicado, fijado al registrar."],
  "Euro (€)": ["Euro (€)", "Euro (€)"],
  "US dollar ($)": ["Dollar US ($)", "Dólar EE. UU. ($)"],
  "Wise payment (real rate)": ["Paiement Wise (taux réel)", "Pago Wise (tipo real)"],
  "None: rate of the day": ["Aucun : taux du jour", "Ninguno: tipo del día"],
  "No USD rate: the entry is kept in USD, marked \"rate missing\" and left out of EUR totals. Enter a manual rate first to convert it.": ["Aucun taux dollar : l'écriture reste en USD, marquée « taux manquant » et hors totaux en €. Saisis d'abord un taux manuel pour la convertir.", "Ningún tipo de cambio: el apunte queda en USD, marcado «tipo pendiente» y fuera de los totales en €. Introduce antes un tipo manual para convertirlo."],
  "Contractors paid in USD": ["Prestataires payés en USD", "Proveedores pagados en USD"],
  "Only to pay contractors in dollars: a Wise payment uses its real rate; before paying, the Wise rate of the day, else your manual rate. Everything else stays in euros.": ["Uniquement pour payer des prestataires en dollars : un paiement Wise utilise son taux réel ; avant de payer, le taux Wise du jour, sinon ton taux manuel. Tout le reste reste en euros.", "Solo para pagar a proveedores en dólares: un pago Wise usa su tipo real; antes de pagar, el tipo Wise del día, si no tu tipo manual. Todo lo demás sigue en euros."],
  "Wise did not give a rate today: the manual rate is used.": ["Wise n'a pas donné de taux aujourd'hui : le taux manuel est utilisé.", "Wise no ha dado tipo hoy: se usa el tipo manual."],
  "Wise is not connected: the manual rate is used.": ["Wise n'est pas connecté : le taux manuel est utilisé.", "Wise no está conectado: se usa el tipo manual."],
  "{n} USD payments have no rate ({x}): left out of EUR totals.": ["{n} paiements en USD sans taux ({x}) : hors totaux en €.", "{n} pagos en USD sin tipo ({x}): fuera de los totales en €."],
  // Clients: projects and contractors
  "USD costs without a rate ({x}) are left out of these EUR totals: enter a manual rate in Money › Movements.": ["Les coûts en USD sans taux ({x}) sont exclus de ces totaux en € : saisis un taux manuel dans Finances › Mouvements.", "Los costes en USD sin tipo ({x}) quedan fuera de estos totales en €: introduce un tipo manual en Finanzas › Movimientos."],
  "Rate ($)": ["Tarif ($)", "Tarifa ($)"],
  "Amount ($)": ["Montant ($)", "Importe ($)"],
  "Not linked to a Wise payment": ["Pas lié à un paiement Wise", "Sin vincular a un pago Wise"],
  // server messages
  "Only a USD cost takes the rate of a Wise payment.": ["Seul un coût en USD prend le taux d'un paiement Wise.", "Solo un coste en USD toma el tipo de un pago Wise."],
  "This Wise movement is not a USD payment.": ["Ce mouvement Wise n'est pas un paiement en USD.", "Este movimiento de Wise no es un pago en USD."],
  "Rate looks wrong: EUR for 1 USD, e.g. 0,92": ["Taux incohérent : € pour 1 $US, par ex. 0,92", "Tipo incoherente: € por 1 $US, p. ej. 0,92"],
  "USD only for paying a supplier": ["USD uniquement pour payer un prestataire", "USD solo para pagar a un proveedor"],
  "Only a USD entry takes the rate of a Wise payment": ["Seule une écriture en USD prend le taux d'un paiement Wise", "Solo un apunte en USD toma el tipo de un pago Wise"],
};
