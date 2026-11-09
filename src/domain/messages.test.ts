import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, whatsappSendLink } from "./playbook";
import { alreadySent, contextOf, defaultChannel, docsIn, isMobileUA, messageFor, missingInfo, nextInSession, sentTo, templateChips, type PlaybookData } from "./messages";

const pb: PlaybookData = { items: [...DEFAULT_PLAYBOOK], links: { calendly: "https://calendly.example.com/theo", deckFR: "https://drive.example.com/deck-fr", deckES: "https://drive.example.com/deck-es" }, founderName: "Théo", signature: "" };

describe("instant messages", () => {
  it("builds the message in the founder's language, with the person's name and the founder's signature", () => {
    const fr = messageFor(pb, "FR", "email", "deck", { name: "Garage Test", contact: "Alex" });
    expect(fr.subject).toBe("La présentation promise, Garage Test");
    expect(fr.body).toMatch(/^Bonjour Alex,/);
    expect(fr.body).toContain("https://drive.example.com/deck-fr");
    expect(fr.body.trim().endsWith("Théo\nValemont")).toBe(true);
    const es = messageFor({ ...pb, signature: "Pablo\nValemont · Madrid" }, "ES", "whatsapp", "thanks", { name: "Taller", contact: "" });
    expect(es.subject).toBe("");
    expect(es.body).toMatch(/^Hola, soy/);
  });
  it("suggests the template from the outcome and never a cold one for Spain", () => {
    expect(templateChips("meeting", [], "FR")).toMatchObject({ suggested: "confirm" });
    expect(templateChips("interested", ["send_info"], "FR").chips[0]).toBe("deck");
    expect(templateChips("no_answer", [], "FR").suggested).toBe("missed");
    const es = templateChips("no_answer", [], "ES");
    expect(es.suggested).toBeNull();
    expect(es.chips).not.toContain("missed");
    expect(templateChips("not_interested", [], "FR").chips).not.toContain("missed"); // talked: no "tried to reach you"
    expect(contextOf("missed")).toBe("cold");
    expect(contextOf("thanks")).toBe("after_call");
  });
  it("picks the channel and asks for what is missing", () => {
    expect(defaultChannel({ email: "a@example.com", phone: "+33600000000" })).toBe("email");
    expect(defaultChannel({ email: "", phone: "+33600000000" })).toBe("whatsapp");
    expect(missingInfo("email", "nope")).toEqual(["email"]);
    expect(missingInfo("whatsapp", "+33 6")).toEqual(["phone"]);
    expect(missingInfo("email", "a@example.com", { needsBusiness: true, business: " " })).toEqual(["business"]);
    expect(missingInfo("email", "a@example.com", { body: "[add your Calendly link in Settings › Workspace]" })).toEqual(["link"]);
    expect(missingInfo("whatsapp", "+33 6 00 00 00 00")).toEqual([]);
  });
  it("shows the documents travelling with the message", () => {
    const m = messageFor(pb, "FR", "email", "deck", { name: "X", contact: "" });
    expect(docsIn(m.body, pb.links).map((d) => d.kind)).toEqual(["deck", "calendly"]);
    expect(docsIn("Bonjour", pb.links)).toEqual([]);
  });
  it("opens WhatsApp Web on a computer and the app on a phone", () => {
    expect(whatsappSendLink("+33 6 00 00 00 01", "Salut & merci", false)).toBe("https://web.whatsapp.com/send?phone=33600000001&text=Salut%20%26%20merci");
    expect(whatsappSendLink("+33 6 00 00 00 01", "Hi", true)).toBe("https://wa.me/33600000001?text=Hi");
    expect(isMobileUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMobileUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
  it("lists what was already sent and flags the same template twice in a week", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const rows = [
      { account_id: "a", channel: "email" as const, template_key: "thanks", sent_at: "2026-11-08T10:00:00Z", status: "sent" },
      { account_id: "a", channel: "whatsapp" as const, template_key: "deck", sent_at: "2026-10-01T10:00:00Z", status: "sent" },
      { account_id: "a", channel: "email" as const, template_key: "confirm", sent_at: "2026-11-08T11:00:00Z", status: "failed" },
      { account_id: "b", channel: "email" as const, template_key: "thanks", sent_at: "2026-11-08T10:00:00Z", status: "sent" },
    ];
    expect(sentTo(rows, "a").map((s) => s.template)).toEqual(["thanks", "deck"]);
    expect(alreadySent(rows, "a", "thanks", now)).toBe(true);
    expect(alreadySent(rows, "a", "deck", now)).toBe(false); // over a week ago
    expect(alreadySent(rows, "a", "confirm", now)).toBe(false); // failed sends do not count
    expect(sentTo(rows, "")).toEqual([]);
  });
  it("walks a message session one by one, skipping done and skipped people", () => {
    const items = [{ key: "1" }, { key: "2" }, { key: "3" }];
    expect(nextInSession(items, new Set(), new Set())?.key).toBe("1");
    expect(nextInSession(items, new Set(["1"]), new Set(["2"]))?.key).toBe("3");
    expect(nextInSession(items, new Set(["1", "3"]), new Set(["2"]))).toBeNull();
  });
});
