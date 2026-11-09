import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import { auditRow, changedFields, enqueueAudit, entityOf, flushAudit, isPrivateMutation, pendingAudit, recordIdOf } from "@/server/services/audit-log";
import { freshSheetsRepo } from "../helpers";

const ID = "6f1c1d9e-3b7a-5d2e-9a64-2c8f0b7e4a11";

describe("audit rows (D084)", () => {
  it("keeps names, never values", () => {
    expect(entityOf("/api/crm/opportunities/")).toBe("crm/opportunities");
    expect(changedFields({ id: ID, expected_version: 3, patch: { stage: "won", amount: 1 } })).toEqual(["stage", "amount"]);
    expect(recordIdOf({ id: "not-a-uuid" }, { row: { id: ID } })).toBe(ID);
    const r = auditRow({ founder: "pablo", method: "PATCH", path: "/api/crm/contacts", status: 409, correlationId: "c-1", input: { id: ID, expected_version: 1, patch: { phone: "+34600000000" } }, secret: "s" });
    expect(r).toMatchObject({ actor: "pablo", action: "PATCH /crm/contacts", table_name: "crm/contacts", record_id: ID, fields: "phone", http_status: 409, audit_scope: "team" });
    expect(JSON.stringify(r)).not.toContain("600000000");
  });

  it("private mutations keep no record id, fields or hash", () => {
    expect(isPrivateMutation("/api/tasks", { task: { private: true } })).toBe(true);
    expect(isPrivateMutation("/api/tasks", { private: false })).toBe(false);
    expect(auditRow({ founder: "theo", method: "POST", path: "/api/tasks", status: 200, correlationId: "c", input: { task: { private: true, title: "x" } }, secret: "s" })).toMatchObject({ table_name: "private", record_id: "", fields: "", input_hash: "", audit_scope: "private" });
  });
});

describe("buffered writer on the fake Sheets server", () => {
  let fake: FakeSheetsServer;
  let repo: DataRepository;
  beforeEach(async () => ({ fake, repo } = await freshSheetsRepo()));
  afterEach(() => fake.stop());

  it("collapses queued rows into one append without bumping revision tokens (spec 4.1)", async () => {
    const before = await repo.revisions({ fresh: true });
    for (let i = 0; i < 5; i++) enqueueAudit(repo, { founder: "theo", method: "POST", path: "/api/ideas", status: 200, correlationId: `c-${i}`, input: { text: "x" }, secret: "s" });
    fake.requestLog.length = 0;
    await flushAudit(repo);
    expect(fake.requestLog.filter((r) => r.path.includes(":append"))).toHaveLength(1);
    expect(fake.requestLog.filter((r) => r.method === "PUT")).toHaveLength(0); // no revision bump
    expect(await repo.revisions({ fresh: true })).toEqual(before);
    expect((await repo.list("AuditLog", { fresh: true })).rows).toHaveLength(5);
  });

  it("keeps rows queued when Sheets fails and writes them on the next flush (never blocks, never throws)", async () => {
    enqueueAudit(repo, { founder: "theo", method: "POST", path: "/api/ideas", status: 200, correlationId: "c-x", input: {}, secret: "s" });
    fake.faults.push({ status: 500, times: 10, pathIncludes: ":append" });
    await flushAudit(repo);
    expect(pendingAudit(repo)).toBe(1);
    fake.faults = [];
    await flushAudit(repo);
    expect(pendingAudit(repo)).toBe(0);
    expect((await repo.list("AuditLog", { fresh: true })).rows.map((r) => r.correlation_id)).toEqual(["c-x"]);
  });
});
