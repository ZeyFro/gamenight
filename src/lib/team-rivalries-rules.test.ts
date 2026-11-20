import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  MAX_OPEN_CHALLENGES_PER_TEAM,
  captainIdOf,
  challengeInputSchema,
  computeRecord,
  confirmDecision,
  proposalDecision,
  reportDecision,
  respondDecision,
  teamRivalriesEnabled,
  type ChallengeLike,
  type RecordEntry,
} from "./team-rivalries-rules";
import {
  INSTANT_SESSION_DEFAULT_MAX_DURATION_MS,
  INSTANT_SESSION_MAX_DURATION_WITH_INTEREST_MS,
  instantSessionDurationMs,
} from "./instant-session-interest";

const NOW = new Date("2026-11-20T18:00:00.000Z");
const H = 3_600_000;
const challenge = (overrides: Partial<ChallengeLike> = {}): ChallengeLike => ({
  status: "PROPOSED", expiresAt: new Date(NOW.getTime() + H), challengerTeamId: "A", opponentTeamId: "B", reportedByTeamId: null, ...overrides,
});

describe("interrupteur", () => {
  it("n'est actif que pour la valeur exacte true", () => {
    expect(teamRivalriesEnabled({ TEAM_RIVALRIES_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", " true"]) expect(teamRivalriesEnabled({ TEAM_RIVALRIES_ENABLED: value })).toBe(false);
  });
});

describe("Jouer maintenant : durée", () => {
  it("2 h flag allumé, 3 h sinon", () => {
    expect(instantSessionDurationMs({ TEAM_RIVALRIES_ENABLED: "true" })).toBe(INSTANT_SESSION_MAX_DURATION_WITH_INTEREST_MS);
    expect(INSTANT_SESSION_MAX_DURATION_WITH_INTEREST_MS).toBe(2 * H);
    expect(instantSessionDurationMs({})).toBe(INSTANT_SESSION_DEFAULT_MAX_DURATION_MS);
    expect(INSTANT_SESSION_DEFAULT_MAX_DURATION_MS).toBe(3 * H);
  });
});

describe("captainIdOf", () => {
  it("capitaine désigné, sinon créateur", () => {
    expect(captainIdOf({ captainId: "cap", createdById: "creator" })).toBe("cap");
    expect(captainIdOf({ captainId: null, createdById: "creator" })).toBe("creator");
  });
});

describe("saisie", () => {
  it("normalise jeu et message vides", () => {
    const parsed = challengeInputSchema.parse({ challengerTeamId: "A", opponentTeamId: "B", gameName: "  ", message: "" });
    expect(parsed.gameName).toBeUndefined();
    expect(parsed.message).toBeUndefined();
    expect(challengeInputSchema.safeParse({ challengerTeamId: "A", opponentTeamId: "B", message: "x".repeat(301) }).success).toBe(false);
    expect(challengeInputSchema.safeParse({ challengerTeamId: "", opponentTeamId: "B" }).success).toBe(false);
  });
});

describe("proposalDecision", () => {
  const base = { challengerTeamId: "A", opponentTeamId: "B", pairHasOpenChallenge: false, openForChallenger: 0, openForOpponent: 0 };
  it("accepte, refuse soi-même, doublon de paire et trop de défis ouverts", () => {
    expect(proposalDecision(base)).toBe("ok");
    expect(proposalDecision({ ...base, opponentTeamId: "A" })).toBe("same_team");
    expect(proposalDecision({ ...base, pairHasOpenChallenge: true })).toBe("pair_open");
    expect(proposalDecision({ ...base, openForChallenger: MAX_OPEN_CHALLENGES_PER_TEAM })).toBe("too_many");
    expect(proposalDecision({ ...base, openForOpponent: MAX_OPEN_CHALLENGES_PER_TEAM })).toBe("too_many");
  });
});

describe("respondDecision / reportDecision", () => {
  it("répond seulement à une proposition non échue", () => {
    expect(respondDecision(challenge(), NOW)).toBe("ok");
    expect(respondDecision(challenge({ expiresAt: NOW }), NOW)).toBe("expired");
    for (const status of ["ACCEPTED", "DECLINED", "CANCELLED", "COMPLETED", "EXPIRED", "RESULT_REPORTED"] as const) {
      expect(respondDecision(challenge({ status }), NOW)).toBe("not_proposed");
    }
  });
  it("ne déclare un résultat que sur un défi accepté", () => {
    expect(reportDecision({ status: "ACCEPTED" })).toBe("ok");
    for (const status of ["PROPOSED", "RESULT_REPORTED", "COMPLETED", "DECLINED"] as const) expect(reportDecision({ status })).toBe("not_accepted");
  });
});

describe("confirmDecision (les deux capitaines)", () => {
  const reported = challenge({ status: "RESULT_REPORTED", reportedByTeamId: "A" });
  it("seule l'autre équipe confirme ou conteste", () => {
    expect(confirmDecision(reported, "B")).toBe("ok");
    expect(confirmDecision(reported, "A")).toBe("same_team");
  });
  it("rien à confirmer hors résultat déclaré", () => {
    for (const status of ["PROPOSED", "ACCEPTED", "COMPLETED"] as const) expect(confirmDecision(challenge({ status, reportedByTeamId: "A" }), "B")).toBe("not_reported");
    expect(confirmDecision(challenge({ status: "RESULT_REPORTED", reportedByTeamId: null }), "B")).toBe("same_team");
  });
});

describe("computeRecord", () => {
  const entries: RecordEntry[] = [
    { status: "COMPLETED", outcome: "CHALLENGER_WON", challengerTeamId: "A", opponentTeamId: "B" },
    { status: "COMPLETED", outcome: "OPPONENT_WON", challengerTeamId: "A", opponentTeamId: "C" },
    { status: "COMPLETED", outcome: "CHALLENGER_WON", challengerTeamId: "B", opponentTeamId: "A" },
    { status: "COMPLETED", outcome: "DRAW", challengerTeamId: "C", opponentTeamId: "A" },
    { status: "RESULT_REPORTED", outcome: null, challengerTeamId: "A", opponentTeamId: "B" },
    { status: "ACCEPTED", outcome: "CHALLENGER_WON", challengerTeamId: "A", opponentTeamId: "B" },
    { status: "COMPLETED", outcome: "CHALLENGER_WON", challengerTeamId: "X", opponentTeamId: "Y" },
  ];
  it("ne compte que les défis terminés de l'équipe, du bon point de vue", () => {
    expect(computeRecord(entries, "A")).toEqual({ played: 4, wins: 1, losses: 2, draws: 1 });
    expect(computeRecord(entries, "B")).toEqual({ played: 2, wins: 1, losses: 1, draws: 0 });
    expect(computeRecord(entries, "Z")).toEqual({ played: 0, wins: 0, losses: 0, draws: 0 });
  });
});
