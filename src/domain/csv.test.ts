import { describe, expect, it } from "vitest";
import { escapeCsvCell, previewImport, toCsv } from "./csv";

describe("CSV export (scenario 15, export half)", () => {
  it("neutralises formula text but keeps phone and amounts intact", () => {
    expect(escapeCsvCell("=SUM(A1)", "text")).toBe(`"'=SUM(A1)"`);
    expect(escapeCsvCell("@cmd", "text")).toBe(`"'@cmd"`);
    expect(escapeCsvCell("+33612345678", "phone")).toBe(`"+33612345678"`);
    expect(escapeCsvCell("-12.00", "amount")).toBe(`"-12.00"`);
    expect(escapeCsvCell('say "hi"', "text")).toBe(`"say ""hi"""`);
    const csv = toCsv([{ n: "=1+1", p: "+33612345678" }], [
      { label: "Name", kind: "text", get: (r) => r.n },
      { label: "Phone", kind: "phone", get: (r) => r.p },
    ]);
    expect(csv).toBe(`"Name","Phone"\r\n"'=1+1","+33612345678"\r\n`);
  });
});

describe("CSV import preview", () => {
  const empty = { domains: new Map(), emails: new Map(), phones: new Map() };
  it("maps headers, reports unrecognised columns, validates and dedupes", () => {
    const csv = [
      "Company,Website,Telephone,Email,Country,Favourite colour",
      "Plomberie Martin,https://plomberie-martin.example.com,06 12 34 56 78,contact@plomberie-martin.example.com,France,blue",
      "Plomberie Martin bis,www.plomberie-martin.example.com,,,FR,red",
      ",,,,,",
      ",nowhere.example.com,,,FR,",
      "Garage Sol,,612345678,bad-email,ES,",
      "Taller Luna,,+34 611 222 333,,ES,",
    ].join("\n");
    const p = previewImport(csv, { ...empty, phones: new Map([["+34611222333", "acc-existing"]]) });
    expect(p.unrecognized).toEqual(["Favourite colour"]);
    expect(p.mapped).toMatchObject({ Company: "company", Telephone: "phone" });
    expect(p.rows.map((r) => r.status)).toEqual(["new", "duplicate", "invalid", "invalid", "duplicate"]);
    expect(p.rows[1].duplicateOf).toEqual({ reason: "domain", existingAccountId: null, inFileRow: 0 });
    expect(p.rows[4].duplicateOf?.existingAccountId).toBe("acc-existing");
    expect(p.rows[0].data?.country).toBe("FR");
    expect(p.counts).toEqual({ new: 1, duplicate: 2, invalid: 2 });
  });
});
