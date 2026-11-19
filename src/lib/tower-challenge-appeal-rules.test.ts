import { describe, expect, it } from "vitest";
import { canReviewTowerChallengeAppeal, isTowerChallengeAppealWindowOpen, TOWER_CHALLENGE_APPEAL_WINDOW_MS } from "./tower-challenge-appeal-rules";

describe("délai de contestation Tower", () => {
  const resultAnnouncedAt = new Date("2026-11-01T12:00:00.000Z");

  it("accepte jusqu'à la milliseconde précédant les 48 heures et ferme à l'échéance (décision du 17/11)", () => {
    expect(TOWER_CHALLENGE_APPEAL_WINDOW_MS).toBe(48 * 3600000);
    expect(isTowerChallengeAppealWindowOpen(resultAnnouncedAt, new Date("2026-11-02T12:00:00.000Z"))).toBe(true);
    expect(isTowerChallengeAppealWindowOpen(resultAnnouncedAt, new Date("2026-11-03T11:59:59.999Z"))).toBe(true);
    expect(isTowerChallengeAppealWindowOpen(resultAnnouncedAt, new Date("2026-11-03T12:00:00.000Z"))).toBe(false);
  });

  it("ferme si les dates sont invalides ou inversées", () => {
    expect(isTowerChallengeAppealWindowOpen(new Date("invalid"), resultAnnouncedAt)).toBe(false);
    expect(isTowerChallengeAppealWindowOpen(resultAnnouncedAt, new Date("2026-11-01T11:59:59.999Z"))).toBe(false);
  });
});

describe("arbitrage indépendant", () => {
  const base: Parameters<typeof canReviewTowerChallengeAppeal>[0] = {
    reviewerId: "reviewer",
    reviewerRole: "ADMIN",
    authorId: "author",
    authorRole: "MEMBER",
    arbiterId: null,
    isParticipant: false,
    hasVoted: false,
  };

  it("autorise un staff indépendant pour un auteur membre", () => {
    expect(canReviewTowerChallengeAppeal(base)).toBe(true);
  });

  it("refuse l’auteur comme réviseur", () => {
    expect(canReviewTowerChallengeAppeal({ ...base, reviewerId: "author" })).toBe(false);
  });

  it("refuse un participant comme réviseur", () => {
    expect(canReviewTowerChallengeAppeal({ ...base, isParticipant: true })).toBe(false);
  });

  it("refuse l'auteur même s'il est l'arbitre désigné", () => {
    expect(canReviewTowerChallengeAppeal({ ...base, reviewerId: "author", reviewerRole: "MEMBER", authorRole: "OWNER", arbiterId: "author" })).toBe(false);
  });

  it("refuse un votant comme réviseur", () => {
    expect(canReviewTowerChallengeAppeal({ ...base, hasVoted: true })).toBe(false);
  });

  it("exige l'arbitre désigné et un rôle membre si l'auteur est staff", () => {
    expect(canReviewTowerChallengeAppeal({
      ...base, reviewerId: "arbiter", reviewerRole: "MEMBER", authorRole: "OWNER", arbiterId: "arbiter",
    })).toBe(true);
    expect(canReviewTowerChallengeAppeal({
      ...base, reviewerId: "other-admin", reviewerRole: "ADMIN", authorRole: "ADMIN", arbiterId: "arbiter",
    })).toBe(false);
  });
});
