import { describe, expect, it } from "vitest";
import { backupDay, backupName, compareToLive, expiredBackups, isBundle, statsOf, tabStat, verifyStats } from "./backup";

const s = (rows: number, header = ["id", "a"]) => ({ header, rows });

describe("backup rules (D084)", () => {
  it("counts non-empty data rows and trims the header", () => {
    expect(tabStat([["id", "a", ""], ["1", "x"], ["", ""], [], ["2", ""]])).toEqual({ header: ["id", "a"], rows: 2 });
    expect(statsOf({ _Revisions: [["d"]], Tasks: [["id"], ["1"]] })).toEqual({ Tasks: { header: ["id"], rows: 1 } });
  });

  it("verifies a copy exactly, or within the before/after window of a live copy", () => {
    expect(verifyStats({ A: s(3) }, { A: s(3) }).ok).toBe(true);
    expect(verifyStats({ A: s(2) }, { A: s(3) }).issues[0]).toMatchObject({ kind: "fewer_rows", expected: 3, actual: 2 });
    expect(verifyStats({ A: s(4) }, { A: s(3) }).issues[0].kind).toBe("more_rows");
    expect(verifyStats({ A: s(4) }, { A: s(3) }, { A: s(5) }).ok).toBe(true);
    expect(verifyStats({}, { A: s(0) }).issues[0].kind).toBe("missing_tab");
    expect(verifyStats({ A: s(3, ["id", "b"]) }, { A: s(3) }).issues[0].kind).toBe("header_changed");
  });

  it("compares an older backup with live: live may only grow", () => {
    const r = compareToLive({ A: s(2), B: s(1) }, { A: s(5), B: s(1), C: s(0) });
    expect(r).toMatchObject({ ok: true, newerRows: 3 });
    expect(compareToLive({ A: s(6) }, { A: s(5) }).issues[0].kind).toBe("more_rows");
    expect(compareToLive({}, { A: s(1) }).issues[0].kind).toBe("missing_tab");
  });

  it("retention trashes only our old copies and never the newest one", () => {
    const f = (id: string, day: string) => ({ id, name: backupName(day) });
    const files = [f("a", "2026-09-01"), f("b", "2026-10-09"), f("c", "2026-10-10"), f("d", "2026-11-09"), { id: "x", name: "Budget 2020-01-01" }];
    expect(expiredBackups(files, "2026-11-09", 30).map((x) => x.id)).toEqual(["a", "b"]);
    expect(expiredBackups([f("a", "2020-01-01")], "2026-11-09", 30)).toEqual([]);
    expect(backupDay("Budget")).toBeNull();
    expect(backupDay(backupName("2026-11-09"))).toBe("2026-11-09");
  });

  it("recognises a bundle", () => {
    expect(isBundle({ format: "valemont-os-backup", version: 1, tabs: { A: [["id"]] } })).toBe(true);
    expect(isBundle({ format: "other", version: 1, tabs: {} })).toBe(false);
    expect(isBundle({ format: "valemont-os-backup", version: 1, tabs: { A: "x" } })).toBe(false);
  });
});
