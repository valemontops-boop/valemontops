/** wise15. English key → [FR, ES]. D091: the full Wise history (backfill, multi-year CSV) and the all-time Money views. */
export const entries: Record<string, readonly [string, string]> = {
  // history import (Money › Movements)
  "History since the account was opened": ["Historique depuis l'ouverture du compte", "Historial desde la apertura de la cuenta"],
  "Import the whole Wise history": ["Importer tout l'historique Wise", "Importar todo el historial de Wise"],
  "Resume the Wise history import": ["Reprendre l'import de l'historique Wise", "Reanudar la importación del historial de Wise"],
  "Only the last 90 days come from Wise for now.": ["Pour l'instant, seuls les 90 derniers jours viennent de Wise.", "Por ahora solo llegan de Wise los últimos 90 días."],
  "Importing the Wise history…": ["Import de l'historique Wise en cours…", "Importando el historial de Wise…"],
  "Importing the Wise history… back to {d}": ["Import de l'historique Wise en cours… jusqu'au {d}", "Importando el historial de Wise… hasta {d}"],
  "Full Wise history imported, back to {d} · {n} movements added. Done.": ["Historique Wise complet importé, jusqu'au {d} · {n} mouvements ajoutés. Terminé.", "Historial completo de Wise importado, hasta {d} · {n} movimientos añadidos. Terminado."],
  "Import paused, back to {d} · {n} movements added. Resume to continue.": ["Import en pause, jusqu'au {d} · {n} mouvements ajoutés. Reprends pour continuer.", "Importación en pausa, hasta {d} · {n} movimientos añadidos. Reanúdala para continuar."],
  "The import stopped on an error: {e}": ["L'import s'est arrêté sur une erreur : {e}", "La importación se detuvo por un error: {e}"],
  "Wise asks for strong authentication to read the statement history: import the full history as a CSV (steps below).": ["Wise demande une authentification forte pour lire l'historique des relevés : importe tout l'historique en CSV (étapes ci-dessous).", "Wise pide una autenticación reforzada para leer el historial de extractos: importa todo el historial en CSV (pasos abajo)."],
  "Wise history imported: {n} movements added.": ["Historique Wise importé : {n} mouvements ajoutés.", "Historial de Wise importado: {n} movimientos añadidos."],
  "Without the API, export everything from Wise: Statements & reports › select all balances › date range from the account opening to today › CSV, then import the file here (up to 15 MB; movements already there are skipped).": [
    "Sans l'API, exporte tout depuis Wise : Relevés et rapports › sélectionne tous les soldes › période de l'ouverture du compte à aujourd'hui › CSV, puis importe le fichier ici (15 Mo max ; les mouvements déjà présents sont ignorés).",
    "Sin la API, exporta todo desde Wise: Extractos e informes › selecciona todos los saldos › periodo desde la apertura de la cuenta hasta hoy › CSV, y luego importa el archivo aquí (15 MB máx.; los movimientos que ya están se omiten).",
  ],
  "File too large (15 MB max). Export one period at a time.": ["Fichier trop lourd (15 Mo max). Exporte une période à la fois.", "Archivo demasiado pesado (15 MB máx.). Exporta un periodo cada vez."],
  "Part {n} of {total}": ["Partie {n} sur {total}", "Parte {n} de {total}"],
  // server sentences
  "Wise requires strong authentication for the statement history. Import the full history as a CSV statement instead.": ["Wise exige une authentification forte pour l'historique des relevés. Importe plutôt tout l'historique en relevé CSV.", "Wise exige una autenticación reforzada para el historial de extractos. Importa mejor todo el historial como extracto CSV."],
  // all-time Movements
  "Since the start": ["Depuis le début", "Desde el principio"],
  "Since the start ({d})": ["Depuis le début ({d})", "Desde el principio ({d})"],
  "Last 12 months": ["12 derniers mois", "Últimos 12 meses"],
  "All categories": ["Toutes les catégories", "Todas las categorías"],
  "Search a supplier, a client, a label": ["Chercher un fournisseur, un client, un libellé", "Buscar un proveedor, un cliente, un concepto"],
  "Totals of the movements shown": ["Totaux des mouvements affichés", "Totales de los movimientos mostrados"],
  "{n} movements": ["{n} mouvements", "{n} movimientos"],
  "{n} not in EUR, left out of the totals": ["{n} hors EUR, hors totaux", "{n} fuera de EUR, fuera de los totales"],
  "transfers between our balances, founder contributions and loans are neither income nor expenses": ["virements entre nos soldes, apports des fondateurs et prêts ne sont ni des recettes ni des dépenses", "las transferencias entre nuestros saldos, las aportaciones de los fundadores y los préstamos no son ni ingresos ni gastos"],
  "{from}–{to} of {n}": ["{from}–{to} sur {n}", "{from}–{to} de {n}"],
  "Expenses by category over the period": ["Dépenses par catégorie sur la période", "Gastos por categoría en el periodo"],
  "Share": ["Part", "Peso"],
  // P&L by year
  "By year": ["Par année", "Por año"],
  "Managerial P&L by year": ["Compte de résultat de gestion par année", "Cuenta de resultados de gestión por año"],
};
