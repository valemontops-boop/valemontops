/**
 * Post optimizer (founder request round 11, D081): a deterministic, explainable score /100 per destination network.
 * No LLM. It reads the version as it will be pasted (hook, body, CTA, hashtags, link placement, alt text, first comment,
 * cover text, Drive media metadata, checklist ticks, date and time) and returns one line per check, each with the points
 * it earned, why, and the fix. Weights live in SCORE_CONFIG only; texts are English keys translated on screen.
 *
 * What the checks rest on (web research, November 2026; mostly practitioner studies, the platforms publish few numbers):
 * - LinkedIn: dwell time is the main quality signal and posts with likes but little reading are treated as engagement
 *   bait; comment-bait closers ("Agree?", "comment YES") are demoted; links in the post body cut reach, the first-comment
 *   workaround less so (reportedly also discounted since early 2026); 3–5 relevant hashtags at most; 3,000 characters,
 *   "see more" after ≈ 210 (desktop, ≈ 140 on mobile); 900–1,600 characters is the usual sweet spot; weekday mornings
 *   and lunch, Tuesday–Thursday best.
 *   LinkedIn Engineering, dwell time in feed ranking https://www.linkedin.com/blog/engineering/feed/understanding-dwell-time-to-improve-linkedin-feed-ranking ;
 *   eClincher 2026 https://www.eclincher.com/articles/how-the-linkedin-algorithm-works-in-2026-a-guide-for-b2b-growth ;
 *   Expandi https://expandi.io/blog/linkedin-algorithm/ ; Sendible https://www.sendible.com/insights/linkedin-algorithm ;
 *   Digital Applied 2026 https://www.digitalapplied.com/blog/linkedin-algorithm-2026-engagement-strategy-guide ;
 *   character limits: Eden https://eden.so/blog/linkedin-character-limits/ , Ordinal https://www.tryordinal.com/blog/linkedin-post-size .
 * - Instagram: watch time, likes per reach and sends per reach are the top signals (Mosseri, January 2025), originality
 *   wins over reposts/watermarks; hashtags capped at 5 per post and Reel since December 2025 (was 30); captions and
 *   keywords drive Instagram search, and public professional posts are indexed by Google since 10 July 2025; first
 *   125 characters visible; Reels up to 3 minutes, short Reels (≤ 90 s) still recommended; subtitles raise watch time;
 *   weekday late morning / early afternoon and early evening.
 *   Hootsuite https://blog.hootsuite.com/instagram-algorithm/ ; eClincher 2026 https://www.eclincher.com/articles/how-the-instagram-algorithm-works-in-2026 ;
 *   Business Today (5-hashtag cap) https://www.businesstoday.in/technology/news/story/no-more-hashtag-stuffing-instagram-limits-hashtag-usage-to-just-5-per-reel-and-post-507444-2025-12-19 ;
 *   BetaNews https://betanews.com/2025/12/19/instagram-puts-a-limit-on-hashtag-usage/ ;
 *   PPC Land (Google indexing) https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/ ;
 *   Metricool https://metricool.com/instagram-indexing-on-google/ ; Ordinal (Reel length) https://www.tryordinal.com/blog/how-long-can-an-instagram-reel-be ;
 *   Manychat (Reels) https://manychat.com/blog/instagram-reel-algorithm/ .
 * - Posting times: Sprout Social https://sproutsocial.com/insights/best-times-to-post-on-social-media/ ;
 *   Social Media Today on Hootsuite 2025 https://www.socialmediatoday.com/news/hootsuite-best-posting-times-social-platforms-2025/742080/ .
 */
import {
  BEST_HOURS, PLATFORM_LIMITS, charCount, composeCaption, hashtagsIn, inBestHours, isTime, isVideoFile, mediaFit,
  type ContentFormat, type Lang, type LinkPlacement, type MediaRef, type Network,
} from "./content-studio";

export interface ScoreInput {
  network: Network;
  type: ContentFormat;
  language: Lang;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string;
  /** Final link (with UTM) or "". */
  link: string;
  link_placement: LinkPlacement;
  alt_text: string;
  first_comment: string;
  cover_text: string;
  media: MediaRef[];
  /** Ticked checklist keys (e.g. "subtitles"). */
  checklist: string[];
  scheduled_date: string | null;
  scheduled_time: string;
  /** Search words people use (Search Console queries of the version's language) and brand terms. */
  keywords: string[];
  brandTerms: string[];
}
export type FindingStatus = "ok" | "warn" | "bad" | "info";
export type FindingGroup = "algorithm" | "seo" | "format";
export interface Finding { key: string; group: FindingGroup; status: FindingStatus; earned: number; weight: number; message: string; fix: string; vars?: Record<string, string | number> }
export interface ScoreResult { score: number; grade: "good" | "fair" | "weak"; findings: Finding[] }

/** Points per check and network (a check that does not apply to a type is left out of the total). One place to tune. */
export const SCORE_CONFIG = {
  linkedin: { hook: 15, whitespace: 10, length: 10, ending: 10, link: 10, hashtags: 6, tagging: 4, bait: 12, dwell: 8, time: 8, media: 7, keywords: 6, language: 8, readability: 6 },
  instagram: { hook: 14, keywords: 12, hashtags: 10, alt: 6, cta: 10, reelLength: 10, subtitles: 8, cover: 5, time: 8, captionLimit: 4, bait: 6, media: 7, language: 8, readability: 4 },
  /** Thresholds used by the checks. */
  rules: {
    linkedinSweetSpot: [900, 1_600] as const,
    linkedinOkRange: [500, 2_400] as const,
    hookMaxChars: 150,
    paragraphMaxChars: 280,
    maxTags: 5,
    reelSeconds: [7, 90] as const,
    reelMaxSeconds: 180,
    coverMaxChars: 40,
    sentenceWords: [20, 28] as const,
    grade: { good: 80, fair: 60 },
  },
} as const;

/* ---------- text helpers (pure, language-aware for FR / ES) ---------- */

const STOP: Record<"FR" | "ES" | "EN", string[]> = {
  FR: ["le", "les", "des", "est", "et", "une", "pour", "vous", "qui", "dans", "pas", "sur", "avec", "ce", "votre", "nous", "au", "aux", "du", "mais", "ou", "vos", "être", "c'est", "très", "plus", "fait", "ça", "je", "il"],
  ES: ["el", "los", "las", "es", "y", "una", "para", "usted", "su", "tu", "del", "lo", "más", "como", "pero", "con", "por", "muy", "esto", "está", "son", "sus", "tus", "yo", "nos", "al", "qué", "cómo", "también", "hay"],
  EN: ["the", "and", "is", "you", "your", "for", "with", "this", "that", "are", "of", "to", "it", "we", "our", "not", "but", "on", "in", "be"],
};
const words = (s: string) => s.toLowerCase().normalize("NFC").match(/[\p{L}']+/gu) ?? [];
/** Rough language of a text from its function words; null when there are too few to tell. */
export function detectLanguage(text: string): { lang: "FR" | "ES" | "EN" | null; share: number } {
  const w = words(text);
  const counts = (Object.keys(STOP) as ("FR" | "ES" | "EN")[]).map((l) => [l, w.filter((x) => STOP[l].includes(x)).length] as const);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  if (total < 4) return { lang: null, share: 0 };
  const [lang, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { lang, share: n / total };
}
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Keywords present in the text (accent- and case-insensitive, whole words). */
export function keywordsIn(text: string, keywords: string[]) {
  const t = ` ${ascii(text).replace(/[^a-z0-9]+/g, " ")} `; // hashtags count as words
  return [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 3))].filter((k) => t.includes(` ${ascii(k).replace(/[^a-z0-9]+/g, " ").trim()} `));
}
/** Comment / like / tag bait in FR, ES and EN (demoted by LinkedIn and Meta). Matched on the text without accents. */
export const BAIT_PATTERNS: RegExp[] = [
  /\b(commente[zr]?|ecri(s|vez)|tape[zr]?)\s+["«“]?\s*(oui|moi|1|go|info)\b/i,
  /\b(like[zr]?|aime[zr]?)\s+(si|ce post si)\b/i,
  /\b(partage[zr]?|repost(e[zr]?)?)\s+si\b/i,
  /\b(tague|tagge|identifie)[zr]?\s+(un|une|tes|vos|quelqu)/i,
  /\bqui est d'accord\s*\?/i,
  /\bcomenta\s+["«“]?\s*(si|yo|1|info)\b/i,
  /\bdale\s+(like|me gusta)\b/i,
  /\b(etiqueta|menciona)\s+a\b/i,
  /\bcomparte\s+si\b/i,
  /\bquien esta de acuerdo\s*\?/i,
  /\bcomment\s+["“]?(yes|below|1|me)\b/i,
  /\b(like|share)\s+if\b/i,
  /\btag\s+(a|someone|your)\b/i,
  /(^|\n)\s*agree\s*\?\s*$/im,
];
export const isBait = (text: string) => BAIT_PATTERNS.some((re) => re.test(ascii(text)));
const SAVE_SHARE = /(enregistr|sauvegard|partag|envoie|envoyez|commente|dis-moi|dites-moi|ecris-moi|ecrivez-moi|\bdm\b|message|guard|compart|envia|comenta|dime\b|escrib|mensaje|\bsave|\bshare|\bsend|\bcomment|lien en bio|link en bio|enlace en (la )?bio)/i;
const sentences = (s: string) => s.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter((x) => words(x).length > 0);

/* ---------- scorer ---------- */

function grade(score: number): ScoreResult["grade"] {
  return score >= SCORE_CONFIG.rules.grade.good ? "good" : score >= SCORE_CONFIG.rules.grade.fair ? "fair" : "weak";
}
function total(findings: Finding[]): ScoreResult {
  const w = findings.reduce((a, f) => a + f.weight, 0);
  const e = findings.reduce((a, f) => a + f.earned, 0);
  const score = w ? Math.round((e / w) * 100) : 0;
  const order: Record<FindingStatus, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
  return { score, grade: grade(score), findings: [...findings].sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight) };
}
const f = (key: string, group: FindingGroup, weight: number, ratio: number, message: string, fix = "", vars?: Finding["vars"]): Finding => {
  const earned = Math.round(weight * Math.max(0, Math.min(1, ratio)) * 10) / 10;
  const status: FindingStatus = weight === 0 ? "info" : ratio >= 1 ? "ok" : ratio >= 0.5 ? "warn" : "bad";
  return { key, group, status, earned, weight, message, fix: status === "ok" ? "" : fix, ...(vars ? { vars } : {}) };
};

export function scorePost(i: ScoreInput, cfg = SCORE_CONFIG): ScoreResult {
  const text = composeCaption(i.network, i);
  const body = [i.hook, i.caption, i.cta].join("\n\n");
  const out: Finding[] = [];
  const R = cfg.rules;
  const L = PLATFORM_LIMITS[i.network];
  const firstLine = (i.hook.trim() || text.split("\n").find((l) => l.trim()) || "").trim();
  const visible = [...text].slice(0, L.fold).join("");
  const tags = hashtagsIn(text).length;
  const bait = isBait(`${text}\n${i.first_comment}`) ? 1 : 0;
  const kw = keywordsIn(`${text} ${i.cover_text}`, [...i.keywords, ...i.brandTerms]);
  const hasText = charCount(text.trim()) > 0;

  /* shared: language, readability, posting time, media */
  const lang = detectLanguage(body);
  out.push(lang.lang === null
    ? f("language", "seo", (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).language, hasText ? 0.5 : 0, "Too little text to check the language.", "Write the caption in {lang}.", { lang: i.language })
    : lang.lang === i.language && lang.share >= 0.7
      ? f("language", "seo", (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).language, 1, "Written in {lang}, like the version.", "", { lang: i.language })
      : lang.lang === i.language
        ? f("language", "seo", (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).language, 0.5, "Mostly {lang}, with words from another language.", "Keep one language per version: copy the other version, then translate it.", { lang: i.language })
        : f("language", "seo", (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).language, 0, "The text reads as {found}, the version is {lang}.", "Translate the caption, or move it to the right version.", { found: lang.lang, lang: i.language }));
  const sents = sentences(body);
  const avg = sents.length ? sents.reduce((a, s) => a + words(s).length, 0) / sents.length : 0;
  const rw = (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).readability;
  out.push(!sents.length ? f("readability", "seo", rw, 0, "No sentence to read yet.", "Write the body.")
    : avg <= R.sentenceWords[0] ? f("readability", "seo", rw, 1, "Short sentences ({n} words on average).", "", { n: Math.round(avg) })
      : f("readability", "seo", rw, avg <= R.sentenceWords[1] ? 0.5 : 0, "Long sentences ({n} words on average).", "Cut sentences above 20 words in two.", { n: Math.round(avg) }));
  const tw = (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).time;
  if (!i.scheduled_date || !isTime(i.scheduled_time)) out.push(f("time", "algorithm", tw, 0, "No publishing time yet.", "Pick a date and a time in the recommended windows."));
  else {
    const win = inBestHours(i.network, i.scheduled_date, i.scheduled_time);
    const day = BEST_HOURS[i.network].find((w) => w.days.includes(new Date(`${i.scheduled_date}T12:00:00Z`).getUTCDay()));
    out.push(win ? f("time", "algorithm", tw, 1, "{time} is in a good window for this network ({from}–{to}).", "", { time: i.scheduled_time, from: win.from, to: win.to })
      : f("time", "algorithm", tw, 0.4, "{time} is outside the usual best hours.", day ? "Try {pick} this day ({from}–{to})." : "Move it to a weekday.", { time: i.scheduled_time, pick: day?.pick ?? "", from: day?.from ?? "", to: day?.to ?? "" }));
  }
  const fit = mediaFit(i.type, i.network, i.media);
  const mw = (i.network === "linkedin" ? cfg.linkedin : cfg.instagram).media;
  const bad = fit.filter((x) => x.level === "bad"), warn = fit.filter((x) => x.level === "warn");
  out.push(bad.length ? f("media", "format", mw, 0, bad[0].message, "Pick other files from Drive.", bad[0].vars)
    : warn.length ? f("media", "format", mw, 0.5, warn[0].message, i.media.length ? "Check the size and length of the files." : "Pick the media from Drive.", warn[0].vars)
      : f("media", "format", mw, 1, i.media.length ? "Media fits the format." : "Text post: no media needed.", ""));

  if (i.network === "linkedin") {
    const W = cfg.linkedin;
    const n = charCount(text);
    const firstBreak = text.indexOf("\n");
    // Hook: a first line that ends before the "see more" fold, short enough to read at a glance.
    out.push(!firstLine ? f("hook", "algorithm", W.hook, 0, "No hook.", "Write a first line that makes people click “see more”.")
      : charCount(firstLine) > R.hookMaxChars || (firstBreak > L.fold || (firstBreak < 0 && n > L.fold))
        ? f("hook", "algorithm", W.hook, 0.5, "The hook runs past the “see more” cut ({fold} characters).", "Keep the hook under 150 characters, then a line break.", { fold: L.fold })
        : f("hook", "algorithm", W.hook, 1, "Hook visible before “see more”.", ""));
    const paras = text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
    const long = paras.filter((p) => charCount(p) > R.paragraphMaxChars).length;
    out.push(!hasText ? f("whitespace", "algorithm", W.whitespace, 0, "No text yet.", "Write the post.")
      : long ? f("whitespace", "algorithm", W.whitespace, long > 1 ? 0 : 0.5, "{n} block(s) of text over 280 characters.", "Break long blocks into lines of 1–2 sentences with white space.", { n: long })
        : f("whitespace", "algorithm", W.whitespace, 1, "Short lines with white space.", ""));
    const [lo, hi] = R.linkedinSweetSpot, [olo, ohi] = R.linkedinOkRange;
    out.push(n > L.caption ? f("length", "format", W.length, 0, "{n} characters: LinkedIn stops at 3,000.", "Cut {over} characters.", { n, over: n - L.caption })
      : n >= lo && n <= hi ? f("length", "algorithm", W.length, 1, "{n} characters, in the 900–1,600 sweet spot.", "", { n })
        : n >= olo && n <= ohi ? f("length", "algorithm", W.length, 0.5, "{n} characters (900–1,600 reads best).", n < lo ? "Add one example or one number." : "Cut what does not serve the hook.", { n })
          : f("length", "algorithm", W.length, n ? 0.25 : 0, "{n} characters (900–1,600 reads best).", n < lo ? "Develop the idea: story, proof, takeaway." : "Cut what does not serve the hook.", { n }));
    const lastPara = paras.at(-1) ?? "";
    const ends = /\?\s*$/.test(lastPara) || /\?/.test(i.cta) || Boolean(i.cta.trim());
    out.push(f("ending", "algorithm", W.ending, ends ? 1 : 0, ends ? "Ends with a question or a call to action." : "No question or call to action at the end.", "End with a real question for your readers or a clear next step."));
    const linkInBody = /https?:\/\/\S+/i.test(body) || (Boolean(i.link) && i.link_placement === "post");
    out.push(linkInBody ? f("link", "algorithm", W.link, 0, "External link in the post: LinkedIn shows it to fewer people.", "Move the link to the first comment (or leave it out).")
      : i.link && i.link_placement === "first_comment" ? f("link", "algorithm", W.link, 0.8, "Link in the first comment.", "Some 2026 reports say this is also discounted: keep it for posts whose goal is the click.")
        : f("link", "algorithm", W.link, 1, "No external link in the post.", ""));
    out.push(tags > L.hashtagsRec[1] ? f("hashtags", "algorithm", W.hashtags, 0, "{n} hashtags: more than 5 looks like spam.", "Keep 3 relevant hashtags.", { n: tags })
      : tags >= 1 ? f("hashtags", "algorithm", W.hashtags, 1, "{n} hashtag(s).", "", { n: tags })
        : f("hashtags", "algorithm", W.hashtags, 0.6, "No hashtag (little effect on LinkedIn).", "Add up to 3 topic hashtags."));
    const mentions = (text.match(/(^|\s)@[\p{L}\p{N}_.-]+/gu) ?? []).length;
    out.push(mentions > R.maxTags ? f("tagging", "algorithm", W.tagging, 0, "{n} people tagged: more than 5 reads as bait.", "Tag only people who are in the story.", { n: mentions })
      : f("tagging", "algorithm", W.tagging, 1, mentions ? "{n} person(s) tagged." : "Nobody tagged (tag only people concerned).", "", { n: mentions }));
    out.push(f("bait", "algorithm", W.bait, bait ? 0 : 1, bait ? "Engagement bait detected (“comment YES”, “Agree?”…)." : "No engagement bait.", "Ask a real question instead of asking for a reaction."));
    const listy = paras.filter((p) => /^([-•–→✓✔]|\d+[.)])\s/.test(p)).length;
    out.push(!hasText ? f("dwell", "algorithm", W.dwell, 0, "No text yet.", "Write the post.")
      : listy >= 2 || paras.length >= 5 ? f("dwell", "algorithm", W.dwell, 1, "Structure that keeps people reading (steps, list or short blocks).", "")
        : f("dwell", "algorithm", W.dwell, 0.5, "One block: little reason to keep reading.", "Add 3–5 steps or short blocks (time spent reading counts)."));
    out.push(i.keywords.length || i.brandTerms.length
      ? f("keywords", "seo", W.keywords, kw.length ? 1 : 0, kw.length ? "Search words in the post: {list}." : "None of your search words is in the post.", "Use one of: {top}.", { list: kw.slice(0, 3).join(", "), top: i.keywords.slice(0, 3).join(", ") })
      : f("keywords", "seo", 0, 1, "No Search Console words imported: name the topic in plain words.", ""));
  } else {
    const W = cfg.instagram;
    const isReel = i.type === "reel" || i.type === "video";
    out.push(!firstLine ? f("hook", "algorithm", W.hook, 0, "No hook.", "Open the caption with the promise of the post.")
      : charCount(firstLine) > L.fold ? f("hook", "algorithm", W.hook, 0.5, "The hook runs past the first 125 characters.", "Shorten the first line: only 125 characters show before “more”.")
        : f("hook", "algorithm", W.hook, 1, "Hook in the first 125 characters.", ""));
    out.push(i.keywords.length || i.brandTerms.length
      ? f("keywords", "seo", W.keywords, kw.length ? 1 : 0, kw.length ? "Search words in the caption: {list}." : "No search word in the caption (Instagram and Google search read it).", "Use one of: {top}, ideally in the first line.", { list: kw.slice(0, 3).join(", "), top: i.keywords.slice(0, 3).join(", ") })
      : f("keywords", "seo", W.keywords, visible.split(/\s+/).filter((w) => w.length > 5).length >= 3 ? 0.7 : 0.3, "No Search Console words imported: say what the post is about in the first line.", "Name the trade, the city or the problem people search for."));
    out.push(tags > L.hashtagsMax ? f("hashtags", "algorithm", W.hashtags, 0, "{n} hashtags: Instagram allows 5 since December 2025.", "Keep the 3–5 most relevant.", { n: tags })
      : tags >= L.hashtagsRec[0] ? f("hashtags", "algorithm", W.hashtags, 1, "{n} hashtags, in the 3–5 range.", "", { n: tags })
        : f("hashtags", "algorithm", W.hashtags, tags ? 0.5 : 0, "{n} hashtag(s) (3–5 relevant ones recommended).", "Add precise topic hashtags, not generic ones.", { n: tags }));
    if (i.type !== "story") out.push(f("alt", "seo", W.alt, i.alt_text.trim() ? 1 : 0, i.alt_text.trim() ? "Alt text written." : "No alt text.", "Describe the image or the first frame in one sentence (accessibility and search)."));
    const ctaText = `${i.cta}\n${i.caption}`;
    out.push(SAVE_SHARE.test(ascii(ctaText)) ? f("cta", "algorithm", W.cta, 1, "Call to action to save, share, comment or message.", "")
      : i.cta.trim() ? f("cta", "algorithm", W.cta, 0.5, "Call to action without save / share / comment.", "Ask to save it, send it to someone, or comment a word.")
        : f("cta", "algorithm", W.cta, 0, "No call to action.", "Ask to save it, send it to someone, or comment a word."));
    if (isReel) {
      const v = i.media.find(isVideoFile);
      const s = v?.duration_ms !== null && v?.duration_ms !== undefined ? Math.round(v.duration_ms / 1000) : null;
      const [lo, hi] = R.reelSeconds;
      out.push(s === null ? f("reelLength", "format", W.reelLength, 0.5, "Length unknown: keep the Reel between 7 and 90 seconds.", "Pick the video from Drive once it is processed, or check its length.")
        : s >= lo && s <= hi ? f("reelLength", "format", W.reelLength, 1, "{s} s, in the 7–90 s range.", "", { s })
          : s <= R.reelMaxSeconds && s > hi ? f("reelLength", "format", W.reelLength, 0.5, "{s} s: allowed up to 3 minutes, but watch time drops.", "Cut to 90 seconds or less.", { s })
            : f("reelLength", "format", W.reelLength, 0, s < lo ? "{s} s: too short to hold attention." : "{s} s: over the 3-minute Reel limit.", s < lo ? "Aim for 7–90 seconds." : "Cut to 90 seconds or less.", { s }));
    }
    if (isReel || i.type === "story") out.push(f("subtitles", "algorithm", W.subtitles, i.checklist.includes("subtitles") ? 1 : 0, i.checklist.includes("subtitles") ? "Subtitles ticked." : "Subtitles not ticked.", "Burn subtitles in the version's language (most people watch without sound), then tick it."));
    if (isReel || i.type === "carousel") {
      const c = i.cover_text.trim();
      out.push(!c ? f("cover", "format", W.cover, 0, "No cover text.", "Write 3–6 words for the cover: it is what people see in the grid and in search.")
        : charCount(c) > R.coverMaxChars ? f("cover", "format", W.cover, 0.5, "Cover text of {n} characters: hard to read in the grid.", "Keep it under 40 characters.", { n: charCount(c) })
          : f("cover", "format", W.cover, 1, "Cover text ready.", ""));
    }
    if (isReel) out.push(f("audio", "algorithm", 0, 1, "Audio: original or licensed sound; a trending sound helps discovery, re-used audio with another app's watermark hurts.", ""));
    out.push(charCount(text) > L.caption ? f("captionLimit", "format", W.captionLimit, 0, "{n} characters: Instagram stops at 2,200.", "Cut {over} characters.", { n: charCount(text), over: charCount(text) - L.caption })
      : f("captionLimit", "format", W.captionLimit, hasText ? 1 : 0, hasText ? "Caption within 2,200 characters." : "No caption yet.", "Write the caption."));
    out.push(f("bait", "algorithm", W.bait, bait ? 0 : 1, bait ? "Engagement bait detected (“comment YES”, “tag a friend”…)." : "No engagement bait.", "Ask a real question instead of asking for a reaction."));
  }
  return total(out);
}

/** Average of the version scores of a piece (the Kanban card), or null when it has no version yet. */
export const pieceScore = (scores: number[]) => (scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null);
