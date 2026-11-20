import { describe, expect, it } from "vitest";
import { canResubmitAfterNoQuorum, challengeVoteDeadline, evaluateChallengeVote, type ChallengeVote } from "./tower-challenge-voting";
import * as m_p14 from "./tower-challenge-voting";
import * as m_p15 from "./tower-challenge-voting";

const openedAt = new Date("2026-10-28T12:00:00Z");
const closedAt = new Date("2026-10-29T12:00:00Z");
const vote = (voterId: string, approve: boolean, votedAt = openedAt): ChallengeVote => ({ voterId, approve, votedAt });
const evaluate = (votes: ChallengeVote[], now = closedAt) => evaluateChallengeVote({ authorId: "author", openedAt, votes, now });

describe("vote communautaire des défis", () => {
  it("n'accorde rien avant la fin des 24 heures même avec une majorité", () => {
    expect(evaluate([vote("a", true), vote("b", true), vote("c", true)], new Date(closedAt.getTime() - 1))).toMatchObject({ status: "OPEN" });
  });
  it("valide à l'échéance avec trois votants et une majorité favorable", () => {
    expect(evaluate([vote("a", true), vote("b", true), vote("c", false)])).toEqual({ status: "APPROVED", approvals: 2, rejections: 1 });
  });
  it("refuse avec une majorité défavorable", () => {
    expect(evaluate([vote("a", false), vote("b", false), vote("c", true)])).toMatchObject({ status: "REJECTED" });
  });
  it.each([0, 1, 2])("demande l'unique prolongation de 24 h à l'échéance si le quorum de trois votants manque (%i votes)", count => {
    expect(evaluate(Array.from({ length: count }, (_,i) => vote(String(i), true)))).toEqual({ status: "EXTEND", approvals: count, rejections: 0 });
  });
  it("ne compte jamais deux fois le même votant pour atteindre le quorum", () => {
    expect(() => evaluate([vote("a", true), vote("a", true), vote("b", true)])).toThrow(RangeError);
  });
  it("décide dès 24 h avec exactement trois votants et une majorité stricte, sans prolonger", () => {
    expect(evaluate([vote("a", true), vote("b", true), vote("c", false)])).toMatchObject({ status: "APPROVED" });
    expect(evaluate([vote("a", false), vote("b", false), vote("c", true)])).toMatchObject({ status: "REJECTED" });
  });
  it("refuse à l'échéance si les votes sont à égalité", () => {
    expect(evaluate([vote("a", true), vote("b", true), vote("c", false), vote("d", false)])).toMatchObject({ status: "REJECTED" });
  });
  it("refuse les votes de l'auteur et les votants dupliqués", () => {
    expect(() => evaluate([vote("author", true)])).toThrow(RangeError);
    expect(() => evaluate([vote("a", true), vote("a", false)])).toThrow(RangeError);
  });
  it("refuse les votes hors fenêtre, futurs ou avec une date invalide", () => {
    for (const invalid of [new Date(openedAt.getTime() - 1), closedAt, new Date(NaN)]) {
      expect(() => evaluate([vote("a", true, invalid)])).toThrow(RangeError);
    }
    expect(() => evaluate([vote("a", true, new Date(openedAt.getTime() + 1))], openedAt)).toThrow(RangeError);
  });
  it("refuse les identités vides et les choix non booléens", () => {
    expect(() => evaluate([vote("", true)])).toThrow(RangeError);
    expect(() => evaluate([vote("a", 1 as unknown as boolean)])).toThrow(RangeError);
    expect(() => evaluateChallengeVote({ authorId: "", openedAt, votes: [], now: closedAt })).toThrow(RangeError);
  });
  it("refuse une ouverture future ou un instant invalide", () => {
    expect(() => evaluate([], new Date(openedAt.getTime() - 1))).toThrow(RangeError);
    expect(() => evaluate([], new Date(NaN))).toThrow(RangeError);
    expect(() => evaluateChallengeVote({ authorId: "author", openedAt: new Date(NaN), votes: [], now: closedAt })).toThrow(RangeError);
  });
  it("compte 24 heures réelles au changement d'heure", () => {
    const start = new Date("2026-10-24T12:00:00Z");
    expect(evaluateChallengeVote({ authorId: "author", openedAt: start, votes: [], now: new Date("2026-10-25T11:00:00Z") })).toMatchObject({ status: "OPEN" });
  });
});

describe("prolongation unique et rejet sans quorum", () => {
  const extendedEnd = new Date(openedAt.getTime() + 48 * 3600000);
  const evaluateExtended = (votes: ChallengeVote[], now: Date) => evaluateChallengeVote({ authorId: "author", openedAt, votes, now, extended: true });
  it("garde le vote ouvert entre 24 h et 48 h une fois prolongé, et accepte les votes de la prolongation", () => {
    const late = vote("c", true, new Date(closedAt.getTime() + 3600000));
    expect(evaluateExtended([vote("a", true), late], new Date(extendedEnd.getTime() - 1))).toEqual({ status: "OPEN", approvals: 2, rejections: 0 });
  });
  it("valide à 48 h avec trois votants dont un arrivé pendant la prolongation", () => {
    const late = vote("c", true, new Date(closedAt.getTime() + 3600000));
    expect(evaluateExtended([vote("a", true), vote("b", false), late], extendedEnd)).toMatchObject({ status: "APPROVED" });
  });
  it.each([0, 1, 2])("rejette sans quorum à 48 h (%i votes), jamais une seconde prolongation", count => {
    expect(evaluateExtended(Array.from({ length: count }, (_, i) => vote(String(i), true)), extendedEnd)).toEqual({ status: "NO_QUORUM", approvals: count, rejections: 0 });
  });
  it("traite l'égalité à 48 h comme non validée", () => {
    const late = new Date(closedAt.getTime() + 1000);
    expect(evaluateExtended([vote("a", true), vote("b", false), vote("c", true, late), vote("d", false, late)], extendedEnd)).toMatchObject({ status: "REJECTED" });
  });
  it("refuse un vote à 48 h exactement", () => {
    expect(() => evaluateExtended([vote("a", true, extendedEnd)], extendedEnd)).toThrow(RangeError);
  });
  it("calcule les échéances 24 h puis 48 h", () => {
    expect(challengeVoteDeadline(openedAt).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    expect(challengeVoteDeadline(openedAt, true).toISOString()).toBe("2026-10-30T12:00:00.000Z");
  });
  it("autorise une seule resoumission après un rejet sans quorum", () => {
    expect(canResubmitAfterNoQuorum(0)).toBe(true);
    expect(canResubmitAfterNoQuorum(1)).toBe(false);
    expect(() => canResubmitAfterNoQuorum(-1)).toThrow(RangeError);
    expect(() => canResubmitAfterNoQuorum(0.5)).toThrow(RangeError);
  });
});

// Tâche Qwen qwen-p14-vote-echeance — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-voting · p14-vote-echeance", () => {
  it('echeance du vote a 24 h', () => {
    const o = new Date('2026-03-10T08:00:00Z');
    const d = m_p14.challengeVoteDeadline(o);
    expect(d.toISOString()).toBe('2026-03-11T08:00:00.000Z');
    expect(o.toISOString()).toBe('2026-03-10T08:00:00.000Z');
    expect(d !== o).toBeTruthy();
    expect(() => m_p14.challengeVoteDeadline(new Date(NaN))).toThrow(RangeError);
  });
});

// Tâche Qwen qwen-p15-vote-votants-manquants — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-voting · p15-vote-votants-manquants", () => {
  it('votants manquants pour le quorum de 3', () => {
    expect(m_p15.missingChallengeVoters(0)).toBe(3);
    expect(m_p15.missingChallengeVoters(1)).toBe(2);
    expect(m_p15.missingChallengeVoters(2)).toBe(1);
    expect(m_p15.missingChallengeVoters(3)).toBe(0);
    expect(m_p15.missingChallengeVoters(10)).toBe(0);
    expect(() => m_p15.missingChallengeVoters(-1)).toThrow(RangeError);
    expect(() => m_p15.missingChallengeVoters(1.5)).toThrow(RangeError);
    expect(() => m_p15.missingChallengeVoters(NaN)).toThrow(RangeError);
  });
});
