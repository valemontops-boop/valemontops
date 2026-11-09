import { describe, expect, it } from "vitest";
import { aiEngineOf, classifyTraffic, trafficSplit } from "./marketing";

describe("traffic source classifier (web browser / AI engines / social networks)", () => {
  it("recognises every AI engine, case-insensitively, in any shape", () => {
    expect(aiEngineOf("chatgpt.com")).toBe("ChatGPT");
    expect(aiEngineOf("ChatGPT.com / referral")).toBe("ChatGPT");
    expect(aiEngineOf("utm_source=chatgpt.com")).toBe("ChatGPT");
    expect(aiEngineOf("https://example.com/page?utm_source=chatgpt.com&utm_medium=referral")).toBe("ChatGPT");
    expect(aiEngineOf("https://chat.openai.com/c/abc")).toBe("ChatGPT");
    expect(aiEngineOf("www.perplexity.ai")).toBe("Perplexity");
    expect(aiEngineOf("CLAUDE.AI")).toBe("Claude");
    expect(aiEngineOf("gemini.google.com")).toBe("Gemini");
    expect(aiEngineOf("bard.google.com")).toBe("Gemini");
    expect(aiEngineOf("copilot.microsoft.com")).toBe("Copilot");
    expect(aiEngineOf("edgeservices.bing.com")).toBe("Copilot");
    expect(aiEngineOf("chat.deepseek.com")).toBe("DeepSeek");
    expect(aiEngineOf("chat.mistral.ai")).toBe("Mistral Le Chat");
    expect(aiEngineOf("you.com")).toBe("You.com");
    expect(aiEngineOf("phind.com")).toBe("Phind");
    expect(aiEngineOf("grok.com")).toBe("Grok");
    expect(aiEngineOf("perplexity")).toBe("Perplexity");
  });
  it("does not mistake ordinary sources for AI engines", () => {
    for (const s of ["google", "google.com", "bing.com", "(direct)", "instagram.com", "claude-plomberie.example.com", "youtube.com", "x.com", "mail.google.com"]) expect(aiEngineOf(s)).toBeNull();
  });
  it("splits web browser visits (search, paid, direct, referral) from AI engines and social networks", () => {
    expect(classifyTraffic("google", "organic")).toEqual({ group: "web", kind: "search", engine: null });
    expect(classifyTraffic("google", "cpc")).toMatchObject({ group: "web", kind: "paid" });
    expect(classifyTraffic("bing.com", "referral")).toMatchObject({ group: "web", kind: "search" });
    expect(classifyTraffic("(direct)", "(none)")).toMatchObject({ group: "web", kind: "direct" });
    expect(classifyTraffic("annuaire.example.com", "referral")).toMatchObject({ group: "web", kind: "referral" });
    expect(classifyTraffic("chatgpt.com", "referral")).toEqual({ group: "ai", kind: "ai", engine: "ChatGPT" });
    expect(classifyTraffic("gemini.google.com / referral")).toMatchObject({ group: "ai", engine: "Gemini" });
    expect(classifyTraffic("instagram", "social")).toMatchObject({ group: "social" });
    expect(classifyTraffic("l.instagram.com", "referral")).toMatchObject({ group: "social" });
    expect(classifyTraffic("linkedin.com", "referral")).toMatchObject({ group: "social" });
    expect(classifyTraffic("lnkd.in", "")).toMatchObject({ group: "social" });
    expect(classifyTraffic("m.facebook.com", "referral")).toMatchObject({ group: "social" });
    expect(classifyTraffic("TikTok", "paid_social")).toMatchObject({ group: "social" });
    expect(classifyTraffic("newsletter", "email")).toMatchObject({ group: "web", kind: "other" });
  });
  it("sums sessions and results per group, per web kind and per AI engine", () => {
    const r = (source: string, medium: string, sessions: number, leads = 0) => ({ source, medium, sessions, leads, meetings: null, purchases: 0, revenue_minor: null });
    const s = trafficSplit([r("google", "organic", 50, 1), r("chatgpt.com", "referral", 6, 1), r("perplexity.ai", "referral", 2), r("instagram", "social", 30), r("(direct)", "(none)", 10)]);
    expect(s.groups.web.sessions).toBe(60);
    expect(s.groups.ai).toMatchObject({ sessions: 8, leads: 1 });
    expect(s.groups.social.sessions).toBe(30);
    expect(s.kinds.search.sessions).toBe(50);
    expect(s.engines.map((e) => e.engine)).toEqual(["ChatGPT", "Perplexity"]);
  });
});
