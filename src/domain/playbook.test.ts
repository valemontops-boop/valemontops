import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, fill, findItem, gmailComposeLink, hasMissingLink, mailtoLink, mergePlaybook, suggestedFollowUp, whatsappLink } from "./playbook";
import { OBJECTION_GUIDE, objectionGroups, pickVariant, replySteps, replyStats } from "./objections";
import { emailBenchmarks, type SendRow } from "./email";

describe("playbook", () => {
  it("has two three-step replies in FR and ES for every live objection, and one free hotkey each", () => {
    for (const g of OBJECTION_GUIDE) for (const l of ["FR", "ES"] as const) for (const v of [1, 2]) {
      const it = findItem(DEFAULT_PLAYBOOK, "objection", `${g.key}#${v}`, l);
      expect(it?.language).toBe(l);
      expect(replySteps(it!.body)).toHaveLength(3);
    }
    const keys = OBJECTION_GUIDE.map((g) => g.hotkey);
    expect(new Set([...keys, "e", "p", "w", "c", "n", "m", "x"]).size).toBe(keys.length + 7);
  });
  it("tries every reply variant before settling on the one that wins most often", () => {
    const ev = (r: string, won: boolean) => ({ activity_type: "connected_call", outcome: won ? "meeting_booked" : "not_interested", replies: [r] });
    expect(pickVariant("too_expensive", [])).toBe(1);
    let stats = replyStats([...Array.from({ length: 5 }, () => ev("too_expensive#1", false))]);
    expect(pickVariant("too_expensive", stats)).toBe(2); // variant 2 not tried yet
    stats = replyStats([...Array.from({ length: 5 }, (_, i) => ev("too_expensive#1", i === 0)), ...Array.from({ length: 6 }, (_, i) => ev("too_expensive#2", i < 3))]);
    expect(stats.find((s) => s.reply === "too_expensive#2")).toEqual({ reply: "too_expensive#2", uses: 6, won: 3 });
    expect(pickVariant("too_expensive", stats)).toBe(2);
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
    expect(suggestedFollowUp("not_interested", ["too_expensive"])).toBe("thanks_soft");
    expect(suggestedFollowUp("call_back", [])).toBe("thanks");
    expect(suggestedFollowUp("no_answer", [])).toBe("missed");
    expect(suggestedFollowUp("gatekeeper", [])).toBeNull();
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

  it("signs every email with the founder's signature, or first name + Valemont by default", () => {
    for (const l of ["FR", "ES"] as const) for (const it of DEFAULT_PLAYBOOK.filter((i) => i.kind === "email" && i.language === l)) {
      expect(it.body).toContain("{signature}");
      expect(fill(it.body, { founder: "Théo", calendly: "https://example.com/c", deck: "https://example.com/d" })).toMatch(/Théo\nValemont$/);
      expect(fill(it.body, { founder: "Théo", signature: "Théo M.\nValemont · example.com", calendly: "x", deck: "y" })).toMatch(/Théo M\.\nValemont · example\.com$/);
    }
  });

  it("builds a prefilled Gmail compose link with encoded recipient, subject and body", () => {
    const url = new URL(gmailComposeLink("a+b@example.com", "Suite à notre appel", "Bonjour,\nmerci & à bientôt"));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("a+b@example.com");
    expect(url.searchParams.get("su")).toBe("Suite à notre appel");
    expect(url.searchParams.get("body")).toBe("Bonjour,\nmerci & à bientôt");
  });
});

describe("live objection list (D076)", () => {
  it("shows every objection in two groups, brush-offs first, each in the founder's order", () => {
    const g = objectionGroups(["too_expensive", "send_info", "nope", "no_time"]);
    expect(g.map((x) => x.type)).toEqual(["brush_off", "real"]);
    expect(g[0].keys.slice(0, 2)).toEqual(["send_info", "no_time"]);
    expect(g[1].keys[0]).toBe("too_expensive");
    expect(g[0].keys.length + g[1].keys.length).toBe(OBJECTION_GUIDE.length);
    expect(new Set([...g[0].keys, ...g[1].keys]).size).toBe(OBJECTION_GUIDE.length);
  });
});
