import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Scenario 24: no real address, Sheet/Drive id, handle or token in the repository. */
const ROOTS = ["src", "tests", "scripts", "docs", "README.md", "CLAUDE.md", ".env.example", "playwright.config.ts"];
const SKIP = new Set(["node_modules", ".next", "test-results", ".data", "design-inspiration"]);
const ALLOWED_EMAIL = /@(([a-z0-9-]+\.)*example\.(com|org|net)|[a-z0-9-]+\.iam\.gserviceaccount\.com)$/i;

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => (SKIP.has(f) ? [] : files(path.join(p, f))));
}

describe("build separation (scenario 24)", () => {
  const self = path.normalize("tests/integration/build-separation.test.ts");
  const all = ROOTS.flatMap(files).filter((f) => path.normalize(f) !== self).filter((f) => /\.(ts|tsx|md|json|example|css|mjs)$/.test(f) || f.endsWith(".env.example"));
  it("contains no real email address", () => {
    const hits: string[] = [];
    for (const f of all) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,}/g)) {
        if (!ALLOWED_EMAIL.test(m[0])) hits.push(`${f}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it("contains no Google spreadsheet/Drive id, private key or OAuth secret", () => {
    const hits: string[] = [];
    for (const f of all) {
      const t = fs.readFileSync(f, "utf8");
      if (/docs\.google\.com\/(spreadsheets|document)\/d\/[A-Za-z0-9_-]{25,}/.test(t)) hits.push(`${f}: Google doc URL`);
      if (/-----BEGIN PRIVATE KEY-----/.test(t)) hits.push(`${f}: private key`);
      if (/GOCSPX-[A-Za-z0-9_-]{10,}/.test(t)) hits.push(`${f}: OAuth client secret`);
      if (/ya29\.[A-Za-z0-9_-]{20,}/.test(t)) hits.push(`${f}: access token`);
      if (/EAA[A-Za-z0-9]{30,}/.test(t)) hits.push(`${f}: Meta token`);
    }
    expect(hits).toEqual([]);
  });
});
