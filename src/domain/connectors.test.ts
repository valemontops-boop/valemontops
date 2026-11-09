import { describe, expect, it } from "vitest";
import { ENTRIES } from "@/i18n/dict";
import { CONNECTOR_FORMS, checkValue, connectorForm, fieldOf, last4Of, resolveFieldName } from "./connectors";
import { INTEGRATION_KEYS } from "./integrations";

/** Built at runtime: no provider-key-shaped literal in the repository (push protection). */
const fakeKey = (prefix: string, body: string) => [prefix, "live", body].join("_");
const field = (key: string, name: string) => connectorForm(key)!.fields.find((f) => f.name === name)!;

describe("connector forms (D087)", () => {
  it("every form belongs to a hub row and has 3–6 steps, each string translated (FR, ES)", () => {
    for (const f of CONNECTOR_FORMS) {
      expect(INTEGRATION_KEYS).toContain(f.key);
      expect(f.steps.length).toBeGreaterThanOrEqual(3);
      expect(f.steps.length).toBeLessThanOrEqual(6);
      for (const s of [f.does, ...f.steps.map((x) => x.text), ...f.fields.flatMap((x) => [x.label, x.hint]), ...f.urls.map((u) => u.label)]) expect(ENTRIES[s], s).toBeDefined();
      for (const s of f.steps) if (s.link) expect(s.link).toMatch(/^https:\/\//);
    }
  });

  it("checks pasted values lightly and normalises them", () => {
    expect(checkValue(field("stripe", "STRIPE_API_KEY"), `  ${fakeKey("rk", "fixtureabcdef")}  `)).toEqual({ ok: true, value: fakeKey("rk", "fixtureabcdef") });
    expect(checkValue(field("stripe", "STRIPE_API_KEY"), fakeKey("pk", "fixtureabcdef"))).toMatchObject({ ok: false, error: expect.stringMatching(/publishable/) });
    expect(checkValue(field("stripe", "STRIPE_WEBHOOK_SECRET"), ["whsec", "fixtureabcdef"].join("_"))).toMatchObject({ ok: true });
    expect(checkValue(field("wise", "WISE_API_TOKEN"), "\"1b2c3d4e-0000-4000-8000-123456789abc\"")).toEqual({ ok: true, value: "1b2c3d4e-0000-4000-8000-123456789abc" });
    expect(checkValue(field("wise", "WISE_API_TOKEN"), "not-a-token")).toMatchObject({ ok: false });
    expect(checkValue(field("backup", "BACKUP_DRIVE_FOLDER_ID"), "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toEqual({ ok: true, value: "1AbCdEfGhIjKlMnOp" });
    expect(checkValue(field("backup", "BACKUP_RETENTION_DAYS"), "400")).toMatchObject({ ok: false });
    expect(checkValue(field("tracker", "TRACKER_WEBHOOK_URL_{F}"), "http://tracker.example.com")).toMatchObject({ ok: false });
    expect(checkValue(field("inbox", "META_APP_SECRET"), "0123456789abcdef0123456789ABCDEF")).toMatchObject({ ok: true });
    const pem = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----";
    const r = checkValue(field("wise", "WISE_WEBHOOK_PUBLIC_KEY_BASE64"), pem);
    expect(r.ok && atob(r.value)).toContain("BEGIN PUBLIC KEY"); // stored as base64, like the env variable
    expect(checkValue(field("wise", "WISE_WEBHOOK_PUBLIC_KEY_BASE64"), btoa(pem))).toMatchObject({ ok: true });
  });

  it("shows only the end of long values and resolves founder variables", () => {
    expect(last4Of("short")).toBe("");
    expect(last4Of(fakeKey("rk", "fixture0123ABCD"))).toBe("ABCD");
    expect(resolveFieldName("TRACKER_WEBHOOK_URL_{F}", "pablo")).toBe("TRACKER_WEBHOOK_URL_PABLO");
    expect(fieldOf("TRACKER_FEED_TOKEN_THEO")?.form.key).toBe("tracker");
    expect(fieldOf("SESSION_SECRET")).toBeNull(); // bootstrap values are never vault fields
  });
});
