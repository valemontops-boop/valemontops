/**
 * Quote PDF (spec 5.9, D074) with pdf-lib: pure JavaScript, works in the Node runtime of route handlers and in the
 * browser preview. Sober Valemont branding from docs/DESIGN.md tokens, A4, generous spacing, legal footer on every
 * page. Document language = the client's market (FR / ES). Callers check required fields first (never placeholders).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Row } from "@/data/schema/tables";
import { eur, type LegalField, type QuoteTotals, type TaxRule } from "@/domain/quotes";

export interface PdfData {
  quote: Row<"Quotes">;
  lines: Row<"QuoteLines">[];
  totals: QuoteTotals;
  tax: { rule: TaxRule; oneOffTaxMinor: number; mrrTaxMinor: number } | null;
  legal: Record<LegalField, string>;
  client: { name: string; city: string; country: string; contact: string; email: string };
  today: string;
}

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { ink: hex("#17161A"), text2: hex("#57545C"), text3: hex("#6E6A72"), hairline: hex("#E2E0DA"), accent: hex("#2A78D6"), canvas: hex("#F1F0EC"), consulting: hex("#2F5FBF") };

type Lang = "FR" | "ES";
const L = {
  FR: {
    title: "Devis", ref: "Référence", date: "Date", valid: "Valable jusqu'au", version: "Version", from: "Émetteur", to: "Client",
    desc: "Description", qty: "Qté", unit: "P.U. HT", disc: "Remise", total: "Total HT", oneOff: "Paiement unique", monthly: "Abonnement mensuel",
    oneOffTotal: "Total paiement unique HT", mrr: "Abonnement mensuel HT", perMonth: "/ mois", ttc: "Total TTC", ttcMonth: "Total TTC / mois",
    term: "Durée d'engagement : {n} mois", noTerm: "Sans durée d'engagement", firstYear: "Valeur contractuelle de la première année HT",
    firstYearHow: "{a} + 12 × {b}", globalDisc: "Remise globale", scope: "Périmètre", exclusions: "Exclusions", milestones: "Étapes",
    risks: "Hypothèses et risques", pilot: "Conditions du pilote", payment: "Conditions de paiement", validity: "Validité",
    validityText: "Offre valable jusqu'au {date}. Les montants sont exprimés en euros.", accept: "Bon pour accord", acceptHint: "Date, nom, signature et cachet",
    draft: "BROUILLON · NON VALABLE", page: "Page {n} / {t}", companyId: { FR: "SIREN", ES: "NIF" }, vat: "N° TVA", capital: "Capital", iban: "IBAN",
    contact: "À l'attention de", milestoneAmount: "{p} % du paiement unique", note: "Montants hors taxes sauf mention TTC.",
    units: { unit: "unité", project: "forfait", month: "mois", hour: "h", day: "jour", report: "rapport", location: "établissement" } as Record<string, string>,
  },
  ES: {
    title: "Presupuesto", ref: "Referencia", date: "Fecha", valid: "Válido hasta", version: "Versión", from: "Emisor", to: "Cliente",
    desc: "Descripción", qty: "Cant.", unit: "P. unit.", disc: "Dto.", total: "Total", oneOff: "Pago único", monthly: "Suscripción mensual",
    oneOffTotal: "Total pago único (sin IVA)", mrr: "Suscripción mensual (sin IVA)", perMonth: "/ mes", ttc: "Total (IVA incl.)", ttcMonth: "Total (IVA incl.) / mes",
    term: "Duración del compromiso: {n} meses", noTerm: "Sin compromiso de permanencia", firstYear: "Valor contractual del primer año (sin IVA)",
    firstYearHow: "{a} + 12 × {b}", globalDisc: "Descuento global", scope: "Alcance", exclusions: "Exclusiones", milestones: "Hitos",
    risks: "Supuestos y riesgos", pilot: "Condiciones del piloto", payment: "Condiciones de pago", validity: "Validez",
    validityText: "Oferta válida hasta el {date}. Importes en euros.", accept: "Conforme", acceptHint: "Fecha, nombre, firma y sello",
    draft: "BORRADOR · NO VÁLIDO", page: "Página {n} / {t}", companyId: { FR: "SIREN", ES: "NIF" }, vat: "NIF-IVA", capital: "Capital social", iban: "IBAN",
    contact: "A la atención de", milestoneAmount: "{p} % del pago único", note: "Importes sin IVA salvo indicación contraria.",
    units: { unit: "unidad", project: "proyecto", month: "mes", hour: "h", day: "día", report: "informe", location: "establecimiento" } as Record<string, string>,
  },
} as const;

/** Standard PDF fonts are WinAnsi: keep French/Spanish letters and €, replace the few characters they cannot draw. */
export function pdfSafe(s: string): string {
  const extra = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  return s
    .replace(/[   ]/g, " ")
    .replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/×/g, "x").replace(/[‐‑]/g, "-")
    .replace(/[^\n\x20-\xff]/g, (c) => (extra.includes(c) ? c : "?"));
}
const fmtDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] === undefined ? m : String(v[k])));

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        // A single word longer than the line is cut.
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let i = rest.length;
          while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
          out.push(rest.slice(0, i));
          rest = rest.slice(i);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderQuotePdf(d: PdfData): Promise<Uint8Array> {
  const lang: Lang = d.quote.language;
  const T = L[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${T.title} ${d.quote.reference}`));
  doc.setAuthor(pdfSafe(d.legal.legal_name));
  doc.setCreator("Valemont OS");
  doc.setProducer("Valemont OS");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 52, CW = W - 2 * M, FOOT = 64;
  const money = (m: number) => pdfSafe(eur(m, lang));
  const isDraft = d.quote.status === "draft";

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const size = o.size ?? 9.5, font = o.font ?? reg, str = pdfSafe(s);
    const xx = o.align === "right" ? x - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: xx, y: yy, size, font, color: o.color ?? C.ink });
  };
  const rule = (yy: number, color = C.hairline, x1 = M, x2 = W - M, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color });
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
    text("VALEMONT", M, y - 8, { font: bold, size: 10, color: C.ink });
    text(`${T.title} ${d.quote.reference}`, W - M, y - 8, { size: 8.5, color: C.text3, align: "right" });
    y -= 22;
    rule(y);
    y -= 22;
    watermark();
  };
  const ensure = (h: number) => { if (y - h < M + FOOT) newPage(); };
  const watermark = () => {
    if (!isDraft) return;
    page.drawText(pdfSafe(T.draft), { x: 110, y: 260, size: 40, font: bold, color: C.text3, opacity: 0.12, rotate: degrees(35) });
  };
  const paragraph = (s: string, o: { size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = o.size ?? 9.5, lh = size * 1.45, x = M + (o.indent ?? 0);
    for (const ln of wrap(s, reg, size, CW - (o.indent ?? 0))) {
      ensure(lh);
      text(ln, x, y, { size, color: o.color ?? C.text2 });
      y -= lh;
    }
    y -= o.gap ?? 0;
  };
  const heading = (s: string) => {
    ensure(42);
    y -= 10;
    text(s, M, y, { font: bold, size: 11 });
    y -= 8;
    rule(y);
    y -= 16;
  };

  /* ----- first-page header ----- */
  watermark();
  text("VALEMONT", M, y - 14, { font: bold, size: 20, color: C.ink });
  page.drawRectangle({ x: M, y: y - 24, width: 34, height: 2.5, color: C.accent });
  text(T.title, W - M, y - 12, { font: bold, size: 18, align: "right" });
  text(`${T.ref} ${d.quote.reference}`, W - M, y - 28, { size: 9, color: C.text2, align: "right" });
  y -= 58;
  const meta: [string, string][] = [[T.date, fmtDate(d.today)], [T.valid, fmtDate(d.quote.valid_until)], [T.version, String(d.quote.quote_version)]];
  meta.forEach(([k, v], i) => {
    const x = M + i * 120;
    text(k, x, y, { size: 8, color: C.text3 });
    text(v, x, y - 13, { size: 10, font: bold });
  });
  y -= 36;

  /* ----- parties ----- */
  const colW = (CW - 24) / 2;
  const boxTop = y;
  const party = (x: number, title: string, rows: string[]) => {
    let yy = boxTop;
    text(title.toUpperCase(), x, yy, { size: 7.5, font: bold, color: C.text3 });
    yy -= 15;
    rows.filter(Boolean).forEach((r, i) => {
      for (const ln of wrap(r, i === 0 ? bold : reg, i === 0 ? 10.5 : 9, colW - 16)) {
        text(ln, x, yy, { size: i === 0 ? 10.5 : 9, font: i === 0 ? bold : reg, color: i === 0 ? C.ink : C.text2 });
        yy -= i === 0 ? 14 : 12.5;
      }
    });
    return yy;
  };
  const sc = d.legal.seller_country as "FR" | "ES";
  const yA = party(M, T.from, [
    d.legal.legal_name, d.legal.legal_form + (d.legal.share_capital ? ` · ${T.capital} ${d.legal.share_capital}` : ""), d.legal.address,
    `${T.companyId[sc] ?? "ID"} ${d.legal.company_id}`, `${T.vat} ${d.legal.vat_number}`, d.legal.registry,
  ]);
  const yB = party(M + colW + 24, T.to, [d.client.name, [d.client.city, d.client.country].filter(Boolean).join(", "), d.client.contact ? `${T.contact} ${d.client.contact}` : "", d.client.email]);
  y = Math.min(yA, yB) - 18;

  /* ----- lines ----- */
  const cols = { desc: M, qty: M + CW * 0.56, unit: M + CW * 0.7, disc: M + CW * 0.82, total: W - M };
  const tableHead = () => {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 6, width: CW, height: 20, color: C.canvas });
    text(T.desc, cols.desc + 6, y, { size: 8, font: bold, color: C.text2 });
    text(T.qty, cols.qty + 30, y, { size: 8, font: bold, color: C.text2, align: "right" });
    text(T.unit, cols.unit + 52, y, { size: 8, font: bold, color: C.text2, align: "right" });
    text(T.disc, cols.disc + 40, y, { size: 8, font: bold, color: C.text2, align: "right" });
    text(T.total, cols.total - 6, y, { size: 8, font: bold, color: C.text2, align: "right" });
    y -= 24;
  };
  const group = (billing: "one_time" | "monthly", title: string) => {
    const ls = d.lines.filter((l) => l.billing === billing);
    if (!ls.length) return;
    ensure(70);
    text(title, M, y, { font: bold, size: 10, color: C.ink });
    y -= 16;
    tableHead();
    for (const l of ls) {
      const descLines = wrap(l.label, bold, 9.5, CW * 0.54 - 6);
      const detail = l.description ? wrap(l.description, reg, 8.5, CW * 0.54 - 6) : [];
      const h = descLines.length * 13 + detail.length * 11.5 + 10;
      ensure(h);
      const top = y;
      descLines.forEach((ln, i) => text(ln, cols.desc + 6, top - i * 13, { size: 9.5, font: bold }));
      detail.forEach((ln, i) => text(ln, cols.desc + 6, top - descLines.length * 13 - i * 11.5, { size: 8.5, color: C.text2 }));
      const qty = (l.quantity_x100 / 100).toLocaleString(lang === "FR" ? "fr-FR" : "es-ES", { maximumFractionDigits: 2 });
      text(`${qty} ${T.units[l.unit] ?? ""}`.trim(), cols.qty + 30, top, { size: 9, align: "right" });
      text(money(l.unit_price_minor), cols.unit + 52, top, { size: 9, align: "right" });
      text(l.discount_bp ? `${(l.discount_bp / 100).toLocaleString(lang === "FR" ? "fr-FR" : "es-ES")} %` : "—", cols.disc + 40, top, { size: 9, align: "right", color: C.text2 });
      const net = Math.round((l.quantity_x100 * l.unit_price_minor) / 100);
      text(money(net - Math.round((net * l.discount_bp) / 10_000)) + (billing === "monthly" ? ` ${T.perMonth}` : ""), cols.total - 6, top, { size: 9, align: "right", font: bold });
      y -= h;
      rule(y + 5);
    }
    y -= 10;
  };
  group("one_time", T.oneOff);
  group("monthly", T.monthly);

  /* ----- totals ----- */
  const tx = d.tax;
  const rate = tx ? `${tx.rule.label} ${(tx.rule.rate_bp / 100).toLocaleString(lang === "FR" ? "fr-FR" : "es-ES")} %` : "";
  const rows: { k: string; v: string; strong?: boolean; sep?: boolean }[] = [];
  if (d.quote.discount_bp) rows.push({ k: `${T.globalDisc} ${(d.quote.discount_bp / 100).toLocaleString(lang === "FR" ? "fr-FR" : "es-ES")} %`, v: "" });
  if (d.lines.some((l) => l.billing === "one_time")) {
    rows.push({ k: T.oneOffTotal, v: money(d.totals.oneOffMinor), strong: true });
    if (tx) rows.push({ k: rate, v: money(tx.oneOffTaxMinor) }, { k: T.ttc, v: money(d.totals.oneOffMinor + tx.oneOffTaxMinor), sep: true });
  }
  if (d.lines.some((l) => l.billing === "monthly")) {
    rows.push({ k: T.mrr, v: `${money(d.totals.mrrMinor)} ${T.perMonth}`, strong: true });
    if (tx) rows.push({ k: rate, v: `${money(tx.mrrTaxMinor)} ${T.perMonth}` }, { k: T.ttcMonth, v: `${money(d.totals.mrrMinor + tx.mrrTaxMinor)} ${T.perMonth}`, sep: true });
    rows.push({ k: d.quote.term_months ? fill(T.term, { n: d.quote.term_months }) : T.noTerm, v: "" });
  }
  ensure(rows.length * 17 + 60);
  const tx0 = M + CW * 0.42;
  for (const r of rows) {
    text(r.k, tx0, y, { size: 9.5, font: r.strong ? bold : reg, color: r.strong ? C.ink : C.text2 });
    if (r.v) text(r.v, W - M - 6, y, { size: 9.5, font: r.strong ? bold : reg, align: "right" });
    y -= r.sep ? 22 : 17;
    if (r.sep) rule(y + 12, C.hairline, tx0, W - M);
  }
  if (d.totals.firstYearMinor !== null) {
    y -= 4;
    ensure(44);
    page.drawRectangle({ x: tx0 - 8, y: y - 16, width: W - M - tx0 + 8, height: 34, color: C.ink });
    text(T.firstYear, tx0, y + 4, { size: 8.5, color: hex("#FBFAF7") });
    text(fill(T.firstYearHow, { a: money(d.totals.oneOffMinor), b: money(d.totals.mrrMinor) }), tx0, y - 9, { size: 8, color: hex("#C9C6CC") });
    text(money(d.totals.firstYearMinor), W - M - 6, y - 3, { size: 12, font: bold, color: hex("#FBFAF7"), align: "right" });
    y -= 36;
  }
  if (tx?.rule.mention) paragraph(tx.rule.mention, { size: 8.5, color: C.text2 });
  paragraph(T.note, { size: 8, color: C.text3, gap: 6 });

  /* ----- terms ----- */
  const section = (title: string, body: string) => {
    if (!body.trim()) return;
    heading(title);
    paragraph(body, { gap: 4 });
  };
  section(T.scope, d.quote.scope);
  section(T.exclusions, d.quote.exclusions);
  if (d.quote.milestones.length) {
    heading(T.milestones);
    d.quote.milestones.forEach((m, i) => {
      ensure(30);
      text(`${i + 1}.`, M, y, { size: 9.5, font: bold });
      text(m.title, M + 16, y, { size: 9.5, font: bold });
      const right = [m.timing, m.amount_pct ? fill(T.milestoneAmount, { p: m.amount_pct }) : ""].filter(Boolean).join(" · ");
      if (right) text(right, W - M, y, { size: 9, color: C.text2, align: "right" });
      y -= 18;
    });
    y -= 4;
  }
  section(T.risks, d.quote.risks);
  section(T.pilot, d.quote.pilot_terms);
  section(T.payment, d.quote.payment_terms + (d.legal.iban ? `\n${T.iban} ${d.legal.iban}` : ""));
  section(T.validity, fill(T.validityText, { date: fmtDate(d.quote.valid_until) }));
  if (d.legal.legal_mentions.trim()) paragraph(d.legal.legal_mentions, { size: 8, color: C.text3, gap: 6 });

  /* ----- acceptance ----- */
  ensure(110);
  y -= 14;
  const bx = M + CW * 0.5;
  page.drawRectangle({ x: bx, y: y - 78, width: W - M - bx, height: 84, borderColor: C.hairline, borderWidth: 0.8 });
  text(T.accept, bx + 12, y - 12, { size: 10, font: bold });
  text(T.acceptHint, bx + 12, y - 26, { size: 8.5, color: C.text3 });
  y -= 90;

  /* ----- footer on every page ----- */
  const pages = doc.getPages();
  const legalLine = [d.legal.legal_name, d.legal.legal_form, d.legal.share_capital ? `${T.capital} ${d.legal.share_capital}` : "", d.legal.registry, `${T.companyId[sc] ?? "ID"} ${d.legal.company_id}`, `${T.vat} ${d.legal.vat_number}`].filter(Boolean).join(" · ");
  pages.forEach((p, i) => {
    page = p;
    rule(M + 26);
    const lines = wrap(`${legalLine}\n${d.legal.address}`, reg, 7, CW - 70);
    lines.slice(0, 3).forEach((ln, j) => text(ln, M, M + 14 - j * 9, { size: 7, color: C.text3 }));
    text(fill(T.page, { n: i + 1, t: pages.length }), W - M, M + 14, { size: 7, color: C.text3, align: "right" });
  });
  return doc.save();
}
