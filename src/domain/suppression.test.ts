import { describe, expect, it } from "vitest";
import { outreachBlock, type AccountRef, type ContactRef } from "./suppression";
import { normalizeDomain, normalizePhone } from "./normalize";

const contact: ContactRef = { id: "c1", email: "Owner@Plomberie.example.com", phone: "06 12 34 56 78", consent_status: "unknown", account_id: "a1" };
const account: AccountRef = { id: "a1", email: "", phone: "", website: "https://www.plomberie.example.com/contact", domain_normalized: "", country: "FR" };
const entry = (p: object) => ({ kind: "email" as const, value_normalized: "", contact_id: "", account_id: "", is_archived: false, ...p });

describe("normalisation", () => {
  it("normalises phones and domains for matching only", () => {
    expect(normalizePhone("06 12 34 56 78", "FR")).toBe("+33612345678");
    expect(normalizePhone("+33612345678")).toBe("+33612345678");
    expect(normalizePhone("0034 612 345 678")).toBe("+34612345678");
    expect(normalizePhone("612345678", "ES")).toBe("+34612345678");
    expect(normalizeDomain("https://www.plomberie.example.com/contact")).toBe("plomberie.example.com");
    expect(normalizeDomain("someone@garage.example.org")).toBe("garage.example.org");
  });
});

describe("suppression hard block", () => {
  it("blocks an opted-out contact", () => {
    expect(outreachBlock({ ...contact, consent_status: "opted_out" }, account, []).blocked).toBe(true);
  });
  it("blocks by email, phone, domain and contact id", () => {
    expect(outreachBlock(contact, account, [entry({ kind: "email", value_normalized: "owner@plomberie.example.com" })]).blocked).toBe(true);
    expect(outreachBlock(contact, account, [entry({ kind: "phone", value_normalized: "+33612345678" })]).blocked).toBe(true);
    expect(outreachBlock(contact, account, [entry({ kind: "domain", value_normalized: "plomberie.example.com" })]).blocked).toBe(true);
    expect(outreachBlock(contact, account, [entry({ kind: "contact", contact_id: "c1" })]).blocked).toBe(true);
  });
  it("does not block when nothing matches or the entry is archived", () => {
    expect(outreachBlock(contact, account, [entry({ kind: "email", value_normalized: "x@y.example.com" })]).blocked).toBe(false);
    expect(outreachBlock(contact, account, [entry({ kind: "contact", contact_id: "c1", is_archived: true })]).blocked).toBe(false);
  });
});
