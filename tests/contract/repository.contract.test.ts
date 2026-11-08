import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/data/memory";
import { ConflictError, NotFoundError, type DataRepository } from "@/data/repository";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { freshSheetsRepo, uuid } from "../helpers";

const actor = { founder: "theo" };
const fakes: FakeSheetsServer[] = [];
afterAll(async () => {
  for (const f of fakes) await f.stop();
});

const adapters: [string, () => Promise<DataRepository>][] = [
  ["InMemoryRepository", async () => new InMemoryRepository()],
  [
    "GoogleSheetsRepository (fake server)",
    async () => {
      const { fake, repo } = await freshSheetsRepo();
      fakes.push(fake);
      return repo;
    },
  ],
];

const account = (p: Record<string, unknown> = {}) => ({
  id: uuid(), name: "Plomberie Test", sector: "Building trades", niche: "Plumbers", country: "FR" as const, city: "", website: "",
  domain_normalized: "", phone: "", email: "", linkedin_url: "", lead_source: "", lead_type: null, brand: "local" as const,
  owner_founder: "theo" as const, lead_status: "new" as const, observed_problem: "", problem_evidence: "", language: "fr",
  notes: "", import_batch_id: "", ...p,
});

describe.each(adapters)("DataRepository contract: %s", (_name, make) => {
  let repo: DataRepository;
  beforeEach(async () => {
    repo = await make();
  });

  it("inserts and lists records with standard fields", async () => {
    const a = account();
    const [row] = await repo.insert("Accounts", [a], actor);
    expect(row).toMatchObject({ id: a.id, version: 1, is_archived: false, updated_by: "theo" });
    const { rows } = await repo.list("Accounts");
    expect(rows.find((r) => r.id === a.id)?.name).toBe("Plomberie Test");
  });

  it("round-trips special values unchanged (scenario 15)", async () => {
    const a = account({ phone: "+33612345678", notes: "=SUM(A1)", name: "-12.00 Garage" });
    await repo.insert("Accounts", [a], actor);
    const got = await repo.get("Accounts", a.id, { fresh: true });
    expect(got?.phone).toBe("+33612345678");
    expect(got?.notes).toBe("=SUM(A1)");
    expect(got?.name).toBe("-12.00 Garage");
  });

  it("updates with version check and bumps version", async () => {
    const a = account();
    await repo.insert("Accounts", [a], actor);
    const u = await repo.update("Accounts", a.id, 1, { city: "Lyon" }, { founder: "pablo" });
    expect(u).toMatchObject({ version: 2, city: "Lyon", updated_by: "pablo" });
    expect((await repo.get("Accounts", a.id, { fresh: true }))?.city).toBe("Lyon");
  });

  it("refuses a stale version with a ConflictError carrying the current values (scenario 3)", async () => {
    const a = account();
    await repo.insert("Accounts", [a], actor);
    await repo.update("Accounts", a.id, 1, { city: "Lyon" }, { founder: "pablo" });
    const err = await repo.update("Accounts", a.id, 1, { city: "Paris" }, actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).current?.city).toBe("Lyon");
    expect((await repo.get("Accounts", a.id, { fresh: true }))?.city).toBe("Lyon");
  });

  it("throws NotFoundError for unknown ids", async () => {
    await expect(repo.update("Accounts", uuid(), 1, { city: "x" }, actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("changes the domain revision token on write", async () => {
    const before = await repo.revisions({ fresh: true });
    await repo.insert("Accounts", [account()], actor);
    const after = await repo.revisions({ fresh: true });
    expect(after.crm).not.toBe(before.crm);
    expect(after.settings).toBe(before.settings);
  });

  it("rejects invalid records before writing", async () => {
    await expect(repo.insert("Accounts", [account({ name: "" })], actor)).rejects.toThrow(/Invalid Accounts/);
  });
});
