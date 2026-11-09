import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import { addDays, localDate, startOfWeek } from "@/domain/time";
import type { AppContext } from "../context";
import { createPiece, createPieceSchema, saveMetrics, metricsSchema, updatePiece, updateVariant, variantSchema } from "./content-studio";

/**
 * DEMO / preview only (D079): a few synthetic content pieces in every column of the Content Studio, one published
 * French variant with hand-entered 24 h numbers. Never runs in LIVE. Idempotent (fixed ids; skipped once present).
 */
export async function seedDemoContent(repo: DataRepository, now = new Date()) {
  const first = childId("demo-content", "thirty-report");
  if (await repo.get("ContentPieces", first, { fresh: true })) return;
  const ctx = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" } satisfies AppContext;
  const today = localDate(now, "Europe/Paris");
  const week = startOfWeek(today);
  const pieces: { key: string; founder: "theo" | "pablo"; brand: "thirty" | "consulting"; title: string; format: "reel" | "brand_post"; hook: string; stage: "idea" | "script" | "shoot" | "edit" }[] = [
    { key: "thirty-report", founder: "theo", brand: "thirty", title: "Un rapport IA en 30 minutes (démo)", format: "reel", hook: "Votre concurrent le sait déjà.", stage: "edit" },
    { key: "thirty-demo", founder: "pablo", brand: "thirty", title: "Avant / après : la démo (démo)", format: "reel", hook: "Mira lo que cambia en 30 minutos.", stage: "edit" },
    { key: "valemont-audit", founder: "theo", brand: "consulting", title: "Ce que révèle un audit (démo)", format: "reel", hook: "Trois chiffres que personne ne regarde.", stage: "shoot" },
    { key: "thirty-linkedin", founder: "pablo", brand: "thirty", title: "Por qué 30 minutos bastan (demo)", format: "brand_post", hook: "", stage: "script" },
    { key: "valemont-idea", founder: "theo", brand: "consulting", title: "3 erreurs des artisans en ligne (démo)", format: "reel", hook: "", stage: "idea" },
  ];
  for (const p of pieces) {
    const id = childId("demo-content", p.key);
    await createPiece(ctx, p.founder, createPieceSchema.parse({ id, brand: p.brand, title: p.title, format: p.format, hook: p.hook }));
    if (p.stage !== "idea") {
      const cur = (await repo.get("ContentPieces", id, { fresh: true }))!;
      await updatePiece(ctx, p.founder, { id, expected_version: cur.version, patch: { stage: p.stage } });
    }
  }
  // 30/30 report: French published two days ago (or Monday), Spanish scheduled on its default slot.
  const fr = (await repo.get("ContentVariants", childId("content-variant", first, "FR"), { fresh: true }))!;
  const es = (await repo.get("ContentVariants", childId("content-variant", first, "ES"), { fresh: true }))!;
  const pubDay = addDays(today, -2) >= week ? addDays(today, -2) : week;
  const done = ["hook", "subtitles", "cover", "caption", "cta", "link", "hashtags"];
  await updateVariant(ctx, "theo", variantSchema.parse({ id: fr.id, expected_version: fr.version, action: "publish", patch: { destination_url: "https://example.com/fr/30-30", caption: "Un rapport IA sur votre entreprise en 30 minutes.", cta: "Lien en bio", checklist_done: done, scheduled_date: pubDay, platform_post_url: "https://www.instagram.com/reel/example-fr/", published_at: `${pubDay}T10:00:00.000Z` } }));
  await updateVariant(ctx, "pablo", variantSchema.parse({ id: es.id, expected_version: es.version, action: "schedule", patch: { destination_url: "https://example.com/es/30-30", caption: "Un informe IA de tu empresa en 30 minutos.", checklist_done: done.slice(0, 4), scheduled_date: addDays(week, 2) } }));
  await saveMetrics(ctx, "theo", metricsSchema.parse({ variant_id: fr.id, checkpoint: "h24", views: 1840, reach: 1420, likes: 96, comments: 7, saves: 21, shares: 9, profile_visits: 64, link_clicks: 18, site_visits: 14, leads: 2 }));
}
