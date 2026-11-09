import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";

/** IntegrationStatuses id of a hub integration added in Stage 4A (D083). Older ones keep their own ids. */
export const integrationStatusId = (integration: string) => childId("integration", integration);

/**
 * Records the last result of an integration (best effort, never throws). Written only when the status changes, on
 * each error, or every 15 minutes while it stays ok, to spare the Sheets quota (spec 4.1).
 */
export async function recordIntegration(repo: DataRepository, integration: string, ok: boolean, error = "", now = new Date()) {
  try {
    const id = integrationStatusId(integration);
    const cur = await repo.get("IntegrationStatuses", id);
    const status = ok ? "ok" : "error";
    if (ok && cur?.status === "ok" && cur.last_success_at && now.getTime() - Date.parse(cur.last_success_at) < 15 * 60_000) return;
    const patch = { status, last_error: ok ? "" : error.slice(0, 500), ...(ok ? { last_success_at: now.toISOString() } : {}) };
    const fresh = cur ? await repo.get("IntegrationStatuses", id, { fresh: true }) : null;
    if (fresh) await repo.update("IntegrationStatuses", id, fresh.version, patch, { founder: "system" });
    else await repo.insert("IntegrationStatuses", [{ id, integration, last_success_at: null, ...patch }], { founder: "system" });
  } catch {
    /* status is best-effort: the event itself already succeeded or failed on its own */
  }
}
