import { describe, expect, it } from "vitest";
import { evaluateChallengeVote, type ChallengeVote } from "./tower-challenge-voting";

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
  it.each([0, 1, 2])("refuse à l'échéance si le quorum de trois votants n'est pas atteint (%i votes)", count => {
    expect(evaluate(Array.from({ length: count }, (_,i) => vote(String(i), true)))).toEqual({ status: "REJECTED", approvals: count, rejections: 0 });
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
