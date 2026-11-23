import { describe, expect, it } from "vitest";
import { countEstablishedParticipants, isTournamentXpEligible, TOURNAMENT_XP_MIN_TENURE_MS } from "./tournament-xp-eligibility";
import { TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS, TOURNAMENT_XP_WEEKLY_CAP, TOURNAMENT_XP_WINDOW_MS, xpWindowCap } from "./xp";
import { TOWER_VOTER_MIN_TENURE_MS } from "./tower-vote-eligibility";

const now = new Date("2026-12-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const member = (ageMs: number, status = "ACTIVE") => ({ status, joinedAt: new Date(now.getTime() - ageMs) });

describe("éligibilité à l'XP de tournoi (constat 1.11)", () => {
  it("réutilise l'ancienneté des votants Tower (3 jours), sans valeur dupliquée", () => {
    expect(TOURNAMENT_XP_MIN_TENURE_MS).toBe(TOWER_VOTER_MIN_TENURE_MS);
    expect(TOURNAMENT_XP_MIN_TENURE_MS).toBe(3 * DAY);
    expect(TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS).toBe(3);
  });

  it("4 comptes de moins de 3 jours : aucun participant établi, pas d'XP", () => {
    const complices = [member(0), member(DAY), member(2 * DAY), member(3 * DAY - 1)];
    expect(countEstablishedParticipants(complices, now)).toBe(0);
    expect(isTournamentXpEligible(complices, now)).toBe(false);
  });

  it("un tournoi normal d'amis établis garde son XP", () => {
    const amis = [member(30 * DAY), member(90 * DAY), member(10 * DAY), member(3 * DAY)];
    expect(countEstablishedParticipants(amis, now)).toBe(4);
    expect(isTournamentXpEligible(amis, now)).toBe(true);
  });

  it("le seuil est de 3 participants établis : 2 ne suffisent pas, 3 suffisent", () => {
    const deux = [member(30 * DAY), member(30 * DAY), member(0), member(0)];
    const trois = [member(30 * DAY), member(30 * DAY), member(30 * DAY), member(0)];
    expect(isTournamentXpEligible(deux, now)).toBe(false);
    expect(isTournamentXpEligible(trois, now)).toBe(true);
  });

  it("un membre non actif ou sans Membership ne compte pas, même ancien", () => {
    const participants = [member(30 * DAY, "REMOVED"), { status: undefined, joinedAt: undefined }, { status: null, joinedAt: null }, member(30 * DAY), member(30 * DAY)];
    expect(countEstablishedParticipants(participants, now)).toBe(2);
    expect(isTournamentXpEligible(participants, now)).toBe(false);
  });
});

describe("plafond glissant de l'XP de tournoi", () => {
  it("5 gains sur 7 jours, nommés et exportés", () => {
    expect(TOURNAMENT_XP_WEEKLY_CAP).toBe(5);
    expect(TOURNAMENT_XP_WINDOW_MS).toBe(7 * DAY);
    expect(xpWindowCap("TOURNAMENT_RESULT")).toEqual({ max: TOURNAMENT_XP_WEEKLY_CAP, windowMs: TOURNAMENT_XP_WINDOW_MS });
  });

  it("garde les plafonds de 24 h existants et ne plafonne pas les autres motifs", () => {
    expect(xpWindowCap("CREATE_SESSION")).toEqual({ max: 3, windowMs: DAY });
    expect(xpWindowCap("PARTICIPATE")).toEqual({ max: 3, windowMs: DAY });
    expect(xpWindowCap("VOTE")).toBeNull();
    expect(xpWindowCap("SESSION_RESULT")).toBeNull();
  });
});
