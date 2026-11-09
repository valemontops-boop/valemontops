import { describe, expect, it } from "vitest";
import { SCORE_CONFIG, isBait, detectLanguage, keywordsIn, pieceScore, scorePost, type ScoreInput } from "./content-score";
import { mediaFit, type MediaRef } from "./content-studio";
import { ENTRIES } from "@/i18n/dict";

const base: ScoreInput = {
  network: "linkedin", type: "post", language: "FR", hook: "", caption: "", cta: "", hashtags: "", link: "", link_placement: "first_comment",
  alt_text: "", first_comment: "", cover_text: "", media: [], checklist: [], scheduled_date: null, scheduled_time: "", keywords: [], brandTerms: [],
};
const reel = (p: Partial<MediaRef> = {}): MediaRef => ({ file_id: "r1", name: "reel.mp4", mime: "video/mp4", web_link: "https://drive.example.com/r1", thumbnail_link: "", width: 1080, height: 1920, duration_ms: 42_000, ...p });

/** A good French LinkedIn post: hook before the fold, short blocks, a list, ~1,000 characters, question at the end, link in the first comment. */
const GOOD_LI: ScoreInput = {
  ...base,
  hook: "40 appels à froid cette semaine. 3 leçons que je n'attendais pas.",
  caption: [
    "Je pensais que le prix ferait la différence. Ce n'est pas le cas.",
    "1. Les artisans décrochent avant 9 h, pas après. Après, ils sont sur le chantier et le téléphone reste dans le camion.",
    "2. La première phrase compte plus que le prix. On parle de leur chantier, de leurs clients, pas de nous ni de notre offre.",
    "3. Un « non » poli est une porte ouverte pour dans trois mois. Je note la date et je rappelle, avec une seule question.",
    "Résultat : 6 rendez-vous pris, dont 4 avec des plombiers et des électriciens qui n'avaient jamais eu de site web.",
    "Je teste maintenant un script plus court, avec une seule question au début et une preuve chiffrée à la fin.",
    "Ce que j'en retiens pour la prospection des artisans : le bon moment et la bonne phrase valent plus que la meilleure offre.",
  ].join("\n\n"),
  cta: "Et vous, quelle est la phrase qui vous ouvre une conversation ?",
  hashtags: "#prospection #artisans #b2b",
  link: "https://example.com/fr?utm_source=linkedin",
  scheduled_date: "2026-11-10", scheduled_time: "08:30",
  keywords: ["site web artisan", "prospection artisans", "plombiers"],
};

describe("LinkedIn optimizer", () => {
  it("scores a well-built post high and explains every line", () => {
    const r = scorePost(GOOD_LI);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe("good");
    const by = Object.fromEntries(r.findings.map((f) => [f.key, f]));
    expect(by.hook.status).toBe("ok");
    expect(by.length.status).toBe("ok");
    expect(by.link.earned).toBeLessThan(by.link.weight); // first comment: small discount (2026 reports)
    expect(by.keywords.vars?.list).toContain("plombiers");
    expect(by.time.status).toBe("ok");
    expect(by.language.status).toBe("ok");
    expect(r.findings.every((f) => f.earned <= f.weight)).toBe(true);
  });
  it("penalises a link in the post, engagement bait, too many hashtags and a wall of text", () => {
    const wall = "Voici ce que nous faisons pour les entreprises et pourquoi vous devriez nous contacter aujourd'hui même pour en savoir plus sur notre offre ".repeat(4);
    const r = scorePost({ ...base, hook: wall, caption: "Commentez OUI si vous êtes d'accord. https://example.com/fr", hashtags: "#a #b #c #d #e #f #g", scheduled_date: "2026-11-14", scheduled_time: "22:00" });
    const by = Object.fromEntries(r.findings.map((f) => [f.key, f]));
    expect(by.link).toMatchObject({ status: "bad", earned: 0 });
    expect(by.bait).toMatchObject({ status: "bad", earned: 0 });
    expect(by.hashtags).toMatchObject({ status: "bad", earned: 0 });
    expect(by.hook.status).toBe("warn");
    expect(by.whitespace.status).not.toBe("ok");
    expect(by.time.status).toBe("bad");
    expect(r.grade).toBe("weak");
    expect(r.findings[0].status).toBe("bad"); // worst first
  });
  it("flags a version written in the other language and a text over 3,000 characters", () => {
    const es = scorePost({ ...GOOD_LI, language: "ES" });
    expect(es.findings.find((f) => f.key === "language")).toMatchObject({ status: "bad", vars: { found: "FR", lang: "ES" } });
    const long = scorePost({ ...GOOD_LI, caption: `${GOOD_LI.caption}\n\n${"x ".repeat(1600)}` });
    expect(long.findings.find((f) => f.key === "length")).toMatchObject({ status: "bad", group: "format" });
  });
  it("an empty draft scores low but never fails", () => {
    const r = scorePost(base);
    expect(r.score).toBeLessThan(40);
    expect(r.findings.find((f) => f.key === "keywords")?.weight).toBe(0); // no Search Console data: a note, not a penalty
  });
});

describe("Instagram optimizer", () => {
  const IG: ScoreInput = {
    ...base, network: "instagram", type: "reel", language: "ES",
    hook: "Tu competidor ya tiene su informe de IA. ¿Y tú?",
    caption: "En 30 minutos sabes qué dice internet de tu empresa: reseñas, web y redes. Lo hemos probado con 12 fontaneros en Madrid.",
    cta: "Guárdalo para tu próxima reunión y compártelo con tu socio.",
    hashtags: "#fontaneros #madrid #inteligenciaartificial", alt_text: "Pablo enseña el informe en un móvil", cover_text: "Tu informe en 30 min",
    media: [reel()], checklist: ["subtitles"], scheduled_date: "2026-11-11", scheduled_time: "19:00", keywords: ["fontaneros madrid", "informe ia"],
  };
  it("scores a complete Reel high", () => {
    const r = scorePost(IG);
    expect(r.grade).toBe("good");
    const by = Object.fromEntries(r.findings.map((f) => [f.key, f]));
    expect(by.reelLength).toMatchObject({ status: "ok", vars: { s: 42 } });
    expect(by.cta.status).toBe("ok");
    expect(by.hashtags.status).toBe("ok");
    expect(by.keywords.status).toBe("ok");
    expect(by.audio).toMatchObject({ status: "info", weight: 0 });
  });
  it("applies the 5-hashtag cap, the 3-minute Reel limit and the missing alt text / subtitles / cover", () => {
    const r = scorePost({ ...IG, hashtags: "#a #b #c #d #e #f", alt_text: "", checklist: [], cover_text: "", media: [reel({ duration_ms: 200_000 })] });
    const by = Object.fromEntries(r.findings.map((f) => [f.key, f]));
    expect(by.hashtags).toMatchObject({ status: "bad", vars: { n: 6 } });
    expect(by.reelLength.status).toBe("bad");
    expect(by.alt.status).toBe("bad");
    expect(by.subtitles.status).toBe("bad");
    expect(by.cover.status).toBe("bad");
    expect(by.media.status).toBe("bad");
    expect(r.score).toBeLessThan(scorePost(IG).score - 30);
  });
  it("unknown Reel length is half the points with a hint; a carousel has no Reel checks", () => {
    const r = scorePost({ ...IG, media: [reel({ duration_ms: null, width: null, height: null })] });
    expect(r.findings.find((f) => f.key === "reelLength")).toMatchObject({ status: "warn", earned: SCORE_CONFIG.instagram.reelLength / 2 });
    const c = scorePost({ ...IG, type: "carousel", media: [] });
    expect(c.findings.some((f) => f.key === "reelLength" || f.key === "subtitles")).toBe(false);
    expect(c.findings.some((f) => f.key === "cover")).toBe(true);
  });
  it("detects engagement bait in Spanish and English too", () => {
    for (const text of ["Comenta SÍ si quieres el informe", "Dale like si te sirve", "Etiqueta a un amigo", "Comment YES below", "Tag a friend who needs this"]) {
      expect(isBait(text), text).toBe(true);
    }
    expect(isBait("Guárdalo para luego y cuéntame qué opinas")).toBe(false);
    expect(isBait("Écrivez « OUI » en commentaire")).toBe(true);
  });
});

describe("text helpers", () => {
  it("detects French and Spanish from function words, and stays silent on short texts", () => {
    expect(detectLanguage("Nous avons appelé les artisans pour leur site et ils sont très contents du résultat.").lang).toBe("FR");
    expect(detectLanguage("Hemos llamado a los fontaneros para su web y están muy contentos con el resultado.").lang).toBe("ES");
    expect(detectLanguage("Merci !").lang).toBeNull();
  });
  it("matches keywords without accents or case, whole words only", () => {
    expect(keywordsIn("Un SITE WEB pour artisans à Lyon", ["site web", "artisan", "lyon", "ab"])).toEqual(["site web", "lyon"]);
  });
  it("averages version scores for the card", () => {
    expect(pieceScore([80, 61])).toBe(71);
    expect(pieceScore([])).toBeNull();
  });
});

describe("every optimizer and media line is translated (no English UI)", () => {
  const has = (k: string) => Boolean(ENTRIES[k]);
  it("covers the messages and fixes produced by the fixtures", () => {
    const inputs: ScoreInput[] = [base, GOOD_LI, { ...GOOD_LI, language: "ES" }, { ...GOOD_LI, link_placement: "post", hashtags: "", caption: "@a @b @c @d @e @f" },
      { ...base, network: "instagram", type: "reel" }, { ...base, network: "instagram", type: "carousel", hook: "x".repeat(200), cta: "Voir", hashtags: "#a", keywords: ["artisans"] },
      { ...base, network: "instagram", type: "video", media: [reel({ duration_ms: 3_000 })], cover_text: "x".repeat(60) }, { ...base, network: "instagram", type: "story", caption: "Commentez OUI" },
      { ...GOOD_LI, scheduled_time: "23:00" }, { ...GOOD_LI, scheduled_date: "2026-11-15", scheduled_time: "23:00" }, { ...base, network: "instagram", type: "reel", media: [reel({ duration_ms: 120_000 })] }];
    const missing = new Set<string>();
    for (const i of inputs) for (const f of scorePost(i).findings) for (const k of [f.message, f.fix].filter(Boolean)) if (!has(k)) missing.add(k);
    const m = (p: Partial<MediaRef>) => reel(p);
    const fits = [mediaFit("reel", "instagram", []), mediaFit("reel", "instagram", [m({ width: null }), m({ file_id: "2", duration_ms: 500_000, width: 100, height: 100 })]), mediaFit("story", "instagram", [m({ duration_ms: 90_000 }), m({ file_id: "z" })]),
      mediaFit("carousel", "instagram", [m({ duration_ms: 90_000 })]), mediaFit("carousel", "instagram", Array.from({ length: 21 }, (_, i) => m({ file_id: `${i}`, mime: "image/png" }))), mediaFit("video", "linkedin", [m({ duration_ms: null }), m({ file_id: "q", duration_ms: 900_000 })]),
      mediaFit("post", "instagram", [m({ mime: "image/png" }), m({ file_id: "k", mime: "application/zip" })])];
    for (const list of fits) for (const f of list) if (!has(f.message)) missing.add(f.message);
    expect([...missing]).toEqual([]);
  });
});
