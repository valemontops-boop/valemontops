import { describe, expect, it } from "vitest";
import { GMAIL_SCOPE, GMAIL_SCOPES, checkGmailSender, grantToken } from "./gmail-grant";

describe("Gmail sender check (D090)", () => {
  const sender = "contact@example.com";
  it("asks gmail.send plus openid email, so the callback knows which mailbox granted it", () => {
    expect(GMAIL_SCOPES).toEqual([GMAIL_SCOPE, "openid", "email"]);
  });
  it("accepts only the verified sending address (any case)", () => {
    expect(checkGmailSender({ email: "Contact@Example.com", email_verified: true }, sender)).toEqual({ ok: true, email: "contact@example.com" });
    expect(checkGmailSender({ email: sender, email_verified: "true" }, sender).ok).toBe(true);
  });
  it("refuses another mailbox, an unverified email, a missing claim or a missing sending address", () => {
    expect(checkGmailSender({ email: "theo@example.com", email_verified: true }, sender)).toEqual({ ok: false, error: "wrong_account" });
    expect(checkGmailSender({ email: sender, email_verified: false }, sender)).toEqual({ ok: false, error: "unverified" });
    expect(checkGmailSender(null, sender)).toEqual({ ok: false, error: "no_email" });
    expect(checkGmailSender({ email: sender, email_verified: true }, "")).toEqual({ ok: false, error: "no_sender" });
  });
  it("sends only with the founder's own grant of the current sending address", () => {
    expect(grantToken({ t: "tok", f: "theo", e: sender }, "theo", "CONTACT@example.com")).toBe("tok");
    expect(grantToken({ t: "tok", f: "theo", e: sender }, "pablo", sender)).toBeNull();
    expect(grantToken({ t: "tok", f: "theo", e: "theo@example.com" }, "theo", sender)).toBeNull();
    expect(grantToken({ t: "tok", f: "theo" }, "theo", sender)).toBeNull(); // a pre-D090 cookie: reconnect
    expect(grantToken(null, "theo", sender)).toBeNull();
  });
});
