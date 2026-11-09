import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, LINKEDIN_NOTE_MAX, LINKEDIN_TEMPLATES, fill, findItem } from "./playbook";
import { inmailCredits, invitationLimits, linkedinEventFor, linkedinStats, nextAfter, nextStep, normalizeLinkedInUrl, resultForKey, sequenceState, type LiEvent } from "./linkedin";

const e = (activity_type: string, date: string, outcome: string | null = null): LiEvent => ({ activity_type, outcome, channel: "linkedin", occurred_at: `${date}T10:00:00Z`, local_date: date });

describe("LinkedIn sequence", () => {
  it("derives the stage from the taps: invited → accepted → messaged → replied → qualified → meeting", () => {
    expect(sequenceState([]).stage).toBe("new");
    const ev = [e("linkedin_invitation", "2026-11-01")];
    expect(sequenceState(ev)).toMatchObject({ stage: "invited", invitedAt: "2026-11-01" });
    ev.push(e("linkedin_accepted", "2026-11-03"));
    expect(sequenceState(ev).stage).toBe("accepted");
    ev.push(e("linkedin_dm", "2026-11-03", "sent"));
    expect(sequenceState(ev)).toMatchObject({ stage: "messaged", messagesSinceReply: 1 });
    ev.push(e("reply", "2026-11-05", "conversation"));
    expect(sequenceState(ev)).toMatchObject({ stage: "replied", messagesSinceReply: 0 });
    ev.push(e("qualified_conversation", "2026-11-06", "interested"), e("meeting_booked", "2026-11-07", "meeting_booked"));
    expect(sequenceState(ev).stage).toBe("meeting");
    expect(sequenceState([e("linkedin_invitation", "2026-11-01"), e("reply", "2026-11-02", "not_interested")]).stage).toBe("closed");
  });
  it("ignores replies from other channels (an email reply is not a LinkedIn reply)", () => {
    expect(sequenceState([e("linkedin_invitation", "2026-11-01"), { ...e("reply", "2026-11-02", "conversation"), channel: "email" }]).stage).toBe("invited");
  });
  it("plans the follow-ups: J+7 to check an invitation, then J+3 and J+7 after messages, then stops", () => {
    expect(nextStep(sequenceState([e("linkedin_invitation", "2026-11-01")]))).toMatchObject({ due: "2026-11-08", template: "first_dm" });
    expect(nextStep(sequenceState([e("linkedin_invitation", "2026-11-01"), e("linkedin_accepted", "2026-11-04")]))).toMatchObject({ due: "2026-11-04", template: "first_dm" });
    const one = [e("linkedin_accepted", "2026-11-04"), e("linkedin_dm", "2026-11-04")];
    expect(nextStep(sequenceState(one))).toMatchObject({ due: "2026-11-07", template: "follow_up" });
    const two = [...one, e("linkedin_dm", "2026-11-07")];
    expect(nextStep(sequenceState(two))).toMatchObject({ due: "2026-11-14", template: "follow_up" });
    expect(nextStep(sequenceState([...two, e("linkedin_dm", "2026-11-14")])).due).toBeNull();
    expect(nextAfter("invited", "2026-11-09", 0)).toEqual({ action: "LinkedIn: check if the invitation was accepted", due: "2026-11-16" });
    expect(nextAfter("messaged", "2026-11-09", 1).due).toBe("2026-11-12");
    expect(nextAfter("messaged", "2026-11-09", 2).due).toBe("2026-11-16");
    expect(nextAfter("messaged", "2026-11-09", 3).due).toBe("");
  });
  it("maps each result to one activity event", () => {
    expect(linkedinEventFor("invited")).toEqual({ activity_type: "linkedin_invitation", outcome: "sent" });
    expect(linkedinEventFor("qualified").activity_type).toBe("qualified_conversation");
    expect(linkedinEventFor("not_interested")).toEqual({ activity_type: "reply", outcome: "not_interested" });
    expect(resultForKey({ key: "i", code: "KeyI" })).toBe("invited");
    expect(resultForKey({ key: "è", code: "Digit7" })).toBe("meeting");
    expect(resultForKey({ key: "q", code: "KeyA" })).toBe("qualified"); // AZERTY: the Q letter is read by character
  });
});

describe("LinkedIn limits", () => {
  const inv = (founder_key: string, local_date: string, activity_type = "linkedin_invitation") => ({ founder_key, activity_type, local_date });
  it("counts invitations today and over 7 rolling days, per founder, and blocks at the limit", () => {
    const ev = [...Array.from({ length: 3 }, () => inv("theo", "2026-11-09")), ...Array.from({ length: 5 }, () => inv("theo", "2026-11-03")), inv("theo", "2026-11-02"), inv("pablo", "2026-11-09")];
    expect(invitationLimits(ev, "theo", "2026-11-09", 20, 100)).toMatchObject({ today: 3, week: 8, left: 17, blocked: false });
    expect(invitationLimits(ev, "theo", "2026-11-09", 3, 100)).toMatchObject({ blocked: true, reason: "daily", left: 0 });
    expect(invitationLimits(ev, "theo", "2026-11-09", 20, 8)).toMatchObject({ blocked: true, reason: "weekly" });
  });
  it("counts InMail credits used this month", () => {
    const ev = [inv("theo", "2026-11-01", "inmail"), inv("theo", "2026-10-30", "inmail"), inv("pablo", "2026-11-02", "inmail")];
    expect(inmailCredits(ev, "theo", "2026-11-09", 2)).toEqual({ used: 1, budget: 2, left: 1, blocked: false });
    expect(inmailCredits(ev, "theo", "2026-11-09", 1).blocked).toBe(true);
  });
  it("computes session counts and the acceptance rate", () => {
    const s = linkedinStats([e("linkedin_invitation", "2026-11-01"), e("linkedin_invitation", "2026-11-01"), e("linkedin_accepted", "2026-11-02"), e("linkedin_dm", "2026-11-02"), e("inmail", "2026-11-02"), e("reply", "2026-11-03", "conversation"), e("reply", "2026-11-03", "not_interested")]);
    expect(s).toMatchObject({ invitations: 2, accepted: 1, messages: 1, inmails: 1, replies: 1, notInterested: 1, acceptanceRate: 0.5 });
    expect(linkedinStats([]).acceptanceRate).toBeNull();
  });
});

describe("LinkedIn templates and profiles", () => {
  it("has every LinkedIn template in FR and ES, and the connection note fits in 300 characters once filled", () => {
    for (const k of LINKEDIN_TEMPLATES) for (const l of ["FR", "ES"] as const) expect(findItem(DEFAULT_PLAYBOOK, "linkedin", k, l)?.language).toBe(l);
    for (const l of ["FR", "ES"] as const) {
      const note = fill(findItem(DEFAULT_PLAYBOOK, "linkedin", "invitation", l)!.body, { first_name: "Dominique", business: "Menuiserie Lambert et Fils", founder: "Théo" });
      expect(note.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
      expect(note).toContain("Dominique");
    }
    expect(fill("Merci pour la connexion, {first_name} !", {})).toBe("Merci pour la connexion !");
  });
  it("accepts linkedin.com profile links only", () => {
    expect(normalizeLinkedInUrl("linkedin.com/in/demo-name-example/")).toBe("https://www.linkedin.com/in/demo-name-example");
    expect(normalizeLinkedInUrl("https://fr.linkedin.com/in/demo-x?trk=a")).toBe("https://www.linkedin.com/in/demo-x");
    expect(normalizeLinkedInUrl("https://example.com/in/x")).toBeNull();
    expect(normalizeLinkedInUrl("https://www.linkedin.com/company/x")).toBeNull();
  });
});
