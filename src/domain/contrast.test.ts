import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { contrast } from "./contrast";

/** Scenario 23 (contrast part): reads the shipped tokens from globals.css. */
const css = fs.readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} missing`);
  return m[1];
};

describe("design token contrast", () => {
  const panel = token("panel");
  const canvas = token("canvas");
  it.each(["ink", "text-2", "text-3", "bad", "good", "accent-text"])("%s text is at least 4.5:1 on panel and canvas", (t) => {
    expect(contrast(token(t), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(t), canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it("primary action text is readable on the accent fill", () => {
    expect(contrast(token("on-accent"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });
  it("control borders reach 3:1 (non-text contrast)", () => {
    expect(contrast(token("control-border"), panel)).toBeGreaterThanOrEqual(3);
  });
});
