import { describe, expect, it } from "vitest";
import { filterPeriod, formatCell, inPeriod, major, mdEscape, mdTable, periodDays, presetPeriod, renderMarkdown, sheetName, sheetValue, type ExportDoc } from "./export";

describe("markdown escaping", () => {
  it("escapes pipes and backslashes and turns line breaks into <br>, so a cell never breaks the table", () => {
    expect(mdEscape("A | B")).toBe("A \\| B");
    expect(mdEscape("line 1\nline 2\r\nline 3")).toBe("line 1<br>line 2<br>line 3");
    expect(mdEscape("C:\\path|x")).toBe("C:\\\\path\\|x");
    expect(mdEscape(null)).toBe("");
    expect(mdEscape(12)).toBe("12");
  });
  it("renders a table with one row per record, numbers right-aligned and empty cells as a dash", () => {
    const md = mdTable({ title: "", columns: [{ label: "Name", kind: "text" }, { label: "Calls", kind: "int" }, { label: "Rate", kind: "pct" }, { label: "EUR", kind: "money" }], rows: [["Plomberie | Duval\nParis", 12, 0.256, 1234.5], ["B", null, null, null]] });
    const lines = md.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("| --- | ---: | ---: | ---: |");
    expect(lines[2]).toBe("| Plomberie \\| Duval<br>Paris | 12 | 25.6% | 1234.50 |");
    expect(lines[3]).toBe("| B | — | — | — |");
    expect(mdTable({ title: "", columns: [{ label: "x", kind: "text" }], rows: [] }, "Nothing")).toBe("_Nothing_");
  });
  it("formats numbers plainly for a model", () => {
    expect(formatCell(0.5, "pct")).toBe("50%");
    expect(formatCell(1.23456, "num")).toBe("1.23");
    expect(formatCell(7, "money")).toBe("7.00");
    expect(major(12345)).toBe(123.45);
    expect(major(null)).toBeNull();
  });
  it("quotes founder text line by line so a typed '#' never becomes a heading", () => {
    const doc: ExportDoc = {
      title: "T", meta: [["Period", "a to b"]], definitionsTitle: "Defs", definitions: [["Dials", "Every call"]], questionsTitle: "Q", questions: ["Why?"],
      labels: { term: "Metric", definition: "Definition", field: "Field", value: "Value", empty: "Nothing", readme: "Read me" },
      sections: [{ key: "w", title: "Weekly", tables: [], quotes: [{ heading: "Week", text: "# not a heading\nsecond" }] }],
    };
    const md = renderMarkdown(doc);
    expect(md).toContain("> # not a heading\n> second");
    expect(md).toContain("## 1. Weekly");
    expect(md).toContain("## Q\n\n1. Why?");
    expect(md.startsWith("# T\n")).toBe(true);
  });
});

describe("period filtering", () => {
  it("includes both ends and reads the date part of ISO timestamps", () => {
    expect(inPeriod("2026-11-01", "2026-11-01", "2026-11-07")).toBe(true);
    expect(inPeriod("2026-11-07T23:59:00.000Z", "2026-11-01", "2026-11-07")).toBe(true);
    expect(inPeriod("2026-10-31", "2026-11-01", "2026-11-07")).toBe(false);
    expect(inPeriod("2026-11-08", "2026-11-01", "2026-11-07")).toBe(false);
    expect(inPeriod(null, "2026-11-01", "2026-11-07")).toBe(false);
    expect(filterPeriod([{ d: "2026-11-02" }, { d: "2026-12-01" }, { d: "" }], (r) => r.d, "2026-11-01", "2026-11-30")).toEqual([{ d: "2026-11-02" }]);
    expect(periodDays("2026-11-01", "2026-11-07")).toBe(7);
  });
  it("computes the dialog presets", () => {
    expect(presetPeriod("7d", "2026-11-09")).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(presetPeriod("30d", "2026-11-09")).toEqual({ from: "2026-10-11", to: "2026-11-09" });
    expect(presetPeriod("month", "2026-11-09")).toEqual({ from: "2026-11-01", to: "2026-11-09" });
    expect(presetPeriod("sprint", "2026-11-09", { sprint: { start_date: "2026-11-02", end_date: "2026-11-15" } })).toEqual({ from: "2026-11-02", to: "2026-11-09" });
    expect(presetPeriod("sprint", "2026-11-09", { sprint: null })).toBeNull();
    expect(presetPeriod("custom", "2026-11-09", { from: "2026-11-05", to: "2026-11-01" })).toBeNull();
    expect(presetPeriod("custom", "2026-11-09", { from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("spreadsheet cells", () => {
  it("keeps numbers as numbers and neutralises text a spreadsheet would run as a formula", () => {
    expect(sheetValue(12, "int")).toBe(12);
    expect(sheetValue("=HYPERLINK(\"x\")", "text")).toBe("'=HYPERLINK(\"x\")");
    for (const s of ["+33 6", "-1", "@SUM(A1)"]) expect(sheetValue(s, "text")).toBe("'" + s);
    expect(sheetValue("Plomberie", "text")).toBe("Plomberie");
    expect(sheetValue(null, "int")).toBeNull();
  });
  it("makes valid, unique sheet names", () => {
    const used = new Set<string>();
    expect(sheetName("Pipeline: deals [open]", used)).toBe("Pipeline deals open");
    const long = "A very long section title that goes on and on";
    const a = sheetName(long, used), b = sheetName(long, used);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(b.length).toBeLessThanOrEqual(31);
    expect(a).not.toBe(b);
  });
});
