import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, fill, findItem, hasMissingLink, mailtoLink, mergePlaybook, suggestedFollowUp, whatsappLink } from "./playbook";
import { LIVE_OBJECTIONS, OBJECTION_KEYS } from "./constants";
import { emailBenchmarks, type SendRow } from "./email";

describe("playbook", () => {
  it("has an FR and an ES reply for every live objection, and one hotkey each", () => {
    for (const o of LIVE_OBJECTIONS) for (const l of ["FR", "ES"] as const) expect(findItem(DEFAULT_PLAYBOOK, "objection", o, l)?.language).toBe(l);
    expect(OBJECTION_KEYS).toHaveLength(LIVE_OBJECTIONS.length);
    expect(new Set([...OBJECTION_KEYS, "e", "p", "w", "c", "n"]).size).toBe(OBJECTION_KEYS.length + 5);
  });
  it("fills placeholders and keeps a visible marker for a missing link", () => {
    const t = fill("Bonjour {contact},\n{calendly}\n{founder}", { contact: "Alex", founder: "Théo", calendly: "https://calendly.example.com/t" });
    expect(t).toBe("Bonjour Alex,\nhttps://calendly.example.com/t\nThéo");
    expect(fill("Bonjour {contact},", {})).toBe("Bonjour,");
    expect(fill("Suite à notre appel, {business}", {})).toBe("Suite à notre appel");
    expect(hasMissingLink(fill("{deck}", {}))).toBe(true);
  });
  it("lets a founder row override a default, archived rows do not", () => {
    const items = mergePlaybook([{ kind: "opener", key: "default", language: "FR", subject: "", body: "Mon opener" }, { kind: "opener", key: "default", language: "ES", subject: "", body: "x", is_archived: true }]);
    expect(findItem(items, "opener", "default", "FR")?.body).toBe("Mon opener");
    expect(findItem(items, "opener", "default", "ES")?.body).toMatch(/Valemont/);
  });
  it("suggests the right follow-up after each outcome", () => {
    expect(suggestedFollowUp("meeting", ["send_info"])).toBe("confirm");
    expect(suggestedFollowUp("not_interested", ["send_info"])).toBe("deck");
    expect(suggestedFollowUp("interested", [])).toBe("calendly");
    expect(suggestedFollowUp("not_interested", ["too_expensive"])).toBeNull();
  });
  it("builds click-to-chat and mailto links", () => {
    expect(whatsappLink("+34 900 000 001", "Hola á")).toBe("https://wa.me/34900000001?text=Hola%20%C3%A1");
    expect(mailtoLink("a@b.example.com", "Sujet", "L1\nL2")).toBe("mailto:a@b.example.com?subject=Sujet&body=L1%0AL2");
  });
});

describe("email benchmarks", () => {
  const row = (p: Partial<SendRow>): SendRow => ({ channel: "email", context: "cold", status: "sent", template_key: "calendly", language: "FR", niche: "Garages", sent_at: "2026-11-02T09:00:00.000Z", replied_at: null, reply_kind: null, ...p });
  it("divides replies by emails sent, keeps bounces out of replies and compares cold emails with public ranges", () => {
    const rows = [...Array.from({ length: 18 }, () => row({})), row({ replied_at: "x", reply_kind: "positive" }), row({ replied_at: "x", reply_kind: "bounce" }), row({ status: "failed" }), row({ channel: "whatsapp" })];
    const b = emailBenchmarks(rows, "Europe/Paris", 20);
    expect(b.overall).toMatchObject({ sent: 20, replied: 1, positive: 1, rate: 0.05, enough: true });
    expect(b.bounceRate).toBe(0.05);
    expect(b.cold.verdict).toBe("strong");
    expect(b.byWeekday).toEqual([expect.objectContaining({ key: "Mon", sent: 20 })]);
    expect(emailBenchmarks(rows.slice(0, 5), "Europe/Paris", 20).cold.verdict).toBe("not_enough_data");
  });
});
