import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), seasonVote: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit, getTowerProofMessage: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/tower-challenges", () => ({
  claimSoloTowerChallenge: vi.fn(), getTowerChallengeState: vi.fn(), resolveTowerDiscordActor: mocks.actor,
  settleTowerChallenge: vi.fn(), submitTowerChallengeProof: vi.fn(), voteTowerChallenge: vi.fn(),
  getTowerSeasonLeaderboard: vi.fn(), getTowerSeasonVote: mocks.seasonVote, castTowerSeasonVote: vi.fn(),
}));
import { handleSignedTowerInteraction } from "./discord-tower-challenges";

const app = "100000000000000001";
const guild = "100000000000000002";
const channel = "100000000000000003";
const user = "100000000000000004";
const actor = { communityId: "community", userId: "member" };
const candidate = (userId: string, votes: number, rewardFloors: number) => ({
  userId, discordId: "10000000000000000" + (userId === "a" ? "5" : "6"),
  displayName: "Candidat " + userId, votes, rewardFloors,
});
const voteResult = (candidates: ReturnType<typeof candidate>[]) => ({
  status: "VOTE_CLOSED" as const, voteId: "vote1", myCandidateUserId: null,
  season: { name: "Trimestre 3", active: false, startAt: new Date("2026-04-01T00:00:00Z"), endAt: new Date("2026-07-01T00:00:00Z") },
  closesAt: new Date(Date.now() - 1), candidates,
});

async function renderClosedVote(candidates: ReturnType<typeof candidate>[]) {
  mocks.seasonVote.mockResolvedValue(voteResult(candidates));
  const interaction = {
    type: 2, id: "100000000000000007", application_id: app, token: "simulated",
    guild_id: guild, channel_id: channel, member: { user: { id: user, username: "Joueur" } },
    data: { name: "tower", options: [{ type: 1, name: "vote" }] },
  };
  const response = handleSignedTowerInteraction(interaction, String(Math.floor(Date.now() / 1000)));
  await response.runTower?.();
  return mocks.edit.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", app);
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guild);
  vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", channel);
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
  mocks.actor.mockResolvedValue(actor);
  mocks.edit.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => vi.unstubAllEnvs());

describe("résultat du vote de saison", () => {
  it("ne désigne personne sans bulletin communautaire", async () => {
    const message = await renderClosedVote([candidate("a", 0, 9), candidate("b", 0, 4)]);
    expect(message.content).toContain("Aucun bulletin");
    expect(message.content).not.toContain("🏆 Distinction de saison");
    expect(message.components).toBeUndefined();
  });

  it("n'utilise pas les étages pour départager une égalité de votes", async () => {
    const message = await renderClosedVote([candidate("a", 3, 4), candidate("b", 3, 9)]);
    expect(message.content).toContain("Égalité");
    expect(message.content).not.toContain("🏆 Distinction de saison");
    expect(message.components).toBeUndefined();
  });

  it("attribue la distinction uniquement à une majorité communautaire unique", async () => {
    const message = await renderClosedVote([candidate("a", 4, 4), candidate("b", 3, 9)]);
    expect(message.content).toContain("🏆 Distinction de saison");
    expect(message.content).toContain("Candidat a");
  });
});
