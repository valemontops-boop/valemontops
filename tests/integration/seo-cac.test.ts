import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { AppContext } from "@/server/context";
import type { DataRepository } from "@/data/repository";
import { seedBaseline } from "@/server/services/baseline";
import { addSearchConsoleRow, importSearchConsole, runSiteAudit, safeUrl, seoOverview, type Fetcher } from "@/server/services/seo";
import { demoSiteFetcher } from "@/server/services/demo-seo";
import { marketingFunnels } from "@/server/services/marketing";
import { childId } from "@/lib/ids";
import { freshSheetsRepo } from "../helpers";

const CSV = `Requêtes les plus fréquentes,Clics,Impressions,CTR,Position
site web plombier lyon,9,"1 240","0,7 %","8,6"
valemont,46,130,"35,4 %","1,2"
`;

describe("SEO and cost per channel (fake Sheets)", () => {
  let fake: FakeSheetsServer;
  let ctx: AppContext;
  let repo: DataRepository;
  beforeEach(async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    repo = env.repo;
    ctx = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };
    await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  });
  afterEach(async () => fake.stop());

  it("imports a Search Console export once and summarises the latest period", async () => {
    const input = { language: "FR" as const, period_start: "2026-08-01", period_end: "2026-10-31", csv: CSV, file_name: "Requêtes.csv", commit: true };
    expect(await importSearchConsole(ctx, "theo", input)).toMatchObject({ dimension: "query", rows: 2, newRows: 2 });
    expect(await importSearchConsole(ctx, "theo", input)).toMatchObject({ newRows: 0 });
    await addSearchConsoleRow(ctx, "theo", { language: "FR", period_start: "2026-08-01", period_end: "2026-10-31", dimension: "query", key: "Site Web Plombier Lyon", clicks: 10, impressions: 1_300, position: 8.2 });
    const o = await seoOverview(ctx, "theo", { language: "all", days: 30 });
    expect(o.summary.clicks).toBe(56);
    expect(o.summary.topQueries.find((q) => q.key === "site web plombier lyon")?.impressions).toBe(1_300);
    expect(o.points.some((p) => p.kind === "quick_win")).toBe(true);
    expect(o.audit).toBeNull();
  });

  it("audits only https pages on the configured host and stores the result", async () => {
    await expect(runSiteAudit(ctx, "theo", demoSiteFetcher)).rejects.toThrow(/website address/);
    await repo.insert("SystemSettings", [{ id: childId("setting", "website_url_fr"), key: "website_url_fr", value: "https://www.example.com/fr", description: "" }], { founder: "theo" });
    const asked: string[] = [];
    const spy: Fetcher = async (u) => { asked.push(u); return demoSiteFetcher(u); };
    const a = await runSiteAudit(ctx, "theo", spy);
    expect(a?.pages_checked).toBe(5);
    expect(asked.every((u) => u.startsWith("https://www.example.com/"))).toBe(true);
    expect(a?.issues.some((i) => i.code === "llms_missing")).toBe(true);
    expect(a?.issues.some((i) => i.code === "h1_multiple" && i.page === "/fr/plombiers-lyon")).toBe(true);
    const o = await seoOverview(ctx, "theo", { language: "all", days: 30 });
    expect(o.audit?.id).toBe(a?.id);
    expect(o.ai.checklist.find((x) => x.key === "llms.txt published")?.status).toBe("todo");
  });

  it("refuses unsafe audit targets", () => {
    for (const u of ["http://www.example.com", "https://localhost/x", "https://127.0.0.1/", "https://intranet/", "https://user:pw@www.example.com/", "https://www.example.com:8443/"]) expect(safeUrl(u)).toBeNull();
    expect(safeUrl("https://www.example.com/fr")?.host).toBe("www.example.com");
  });

  it("gives social networks a cost and counts all Money costs except contributions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await repo.insert("ContentLog", [{ id: childId("t-content", "1"), idempotency_key: "k1", founder_key: "theo", deliverable: "reel", brand: "thirty", language: "FR", title: "", url: "", local_date: today }], { founder: "theo" });
    const tx = (k: string, category: string, amount: number, description: string) => ({ id: childId("t-tx", k), bank: "wise" as const, source_id: k, origin: "csv" as const, balance_id: "", currency: "EUR", amount_minor: amount, fee_minor: null, direction: "debit" as const, date: today, occurred_at: new Date().toISOString(), description, counterparty: "", bank_type: "", merchant_category: "", category: category as never, category_source: "manual" as const, running_balance_minor: null, note: "" });
    await repo.insert("BankTransactions", [tx("1", "software", -9900, "LinkedIn Sales Navigator"), tx("2", "software", -1200, "Google Workspace"), tx("3", "founder_contribution", -50000, "Apport")], { founder: "theo" });
    const f = await marketingFunnels(ctx, "theo", { days: 30, scope: "team" });
    expect(f.costs.social.minutes).toBe(90);
    expect(f.costs.social.timeMinor).toBe(4500);
    expect(f.money.totalMinor).toBe(11100);
    expect(f.money.excludedMinor).toBe(50000);
    expect(f.costs.linkedin.directMinor).toBe(9900);
    expect(f.costBasis.hourCostEur).toBe(30);
    expect(f.calls.bench.connectRate).toBe("too_few");
  });
});
