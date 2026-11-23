import { describe, expect, it } from "vitest";
import { isTowerDiscordVotesEnabled, TOWER_VOTER_MIN_TENURE_MS, towerVoterEligibility } from "./tower-vote-eligibility";

const now = new Date("2026-12-10T12:00:00Z");

describe("votants des preuves Tower", () => {
  it("exige un compte actif depuis au moins 3 jours", () => {
    expect(towerVoterEligibility({ status: "ACTIVE", joinedAt: new Date(now.getTime() - TOWER_VOTER_MIN_TENURE_MS), now })).toBe("ELIGIBLE");
    expect(towerVoterEligibility({ status: "ACTIVE", joinedAt: new Date(now.getTime() - TOWER_VOTER_MIN_TENURE_MS + 1), now })).toBe("TOO_RECENT");
    expect(towerVoterEligibility({ status: "ACTIVE", joinedAt: now, now })).toBe("TOO_RECENT");
  });

  it("refuse un compte non actif ou sans Membership", () => {
    const joinedAt = new Date("2026-01-01T00:00:00Z");
    expect(towerVoterEligibility({ status: "REMOVED", joinedAt, now })).toBe("NOT_ACTIVE");
    expect(towerVoterEligibility({ status: undefined, joinedAt: undefined, now })).toBe("NOT_ACTIVE");
    expect(towerVoterEligibility({ status: "ACTIVE", joinedAt: new Date("invalid"), now })).toBe("NOT_ACTIVE");
  });

  it("n'est actif que si le drapeau vaut exactement true", () => {
    expect(isTowerDiscordVotesEnabled({})).toBe(false);
    expect(isTowerDiscordVotesEnabled({ TOWER_DISCORD_VOTES_ENABLED: "TRUE" })).toBe(false);
    expect(isTowerDiscordVotesEnabled({ TOWER_DISCORD_VOTES_ENABLED: "true" })).toBe(true);
  });
});
