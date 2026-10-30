import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  attempt: vi.fn(),
  membership: vi.fn(),
}));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({
    community: { findUnique: mocks.community },
    towerChallengeAttempt: { findFirst: mocks.attempt },
    membership: { findUnique: mocks.membership },
  }),
}));
vi.mock("@/lib/notification-delivery", () => ({
  createNotificationEvent: vi.fn(),
  enqueueDelivery: vi.fn(),
}));
import { towerChallengeAnnounceResolver } from "./tower-challenge-announcements";

const guildId = "100000000000000001";
const proofChannelId = "100000000000000002";
const generalChannelId = "100000000000000003";
const attemptId = "attempt_123";
const description = "Une description publiée au général uniquement après validation.";

function input(kind: "proof" | "success") {
  const proof = kind === "proof";
  return {
    event: {
      category: "ACHIEVEMENT",
      eventType: proof ? "TOWER_PROOF_SUBMITTED" : "TOWER_CHALLENGE_APPROVED",
      communityId: "community_1",
      sourceId: attemptId,
    },
    delivery: {
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: proof ? proofChannelId : generalChannelId,
      targetSlot: guildId + ":TOWER:" + attemptId + ":" + kind,
    },
    now: new Date("2026-10-29T12:00:00Z"),
  } as unknown as Parameters<typeof towerChallengeAnnounceResolver.resolve>[0];
}

function makeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId, userId: "user_1", title: "Défi rigolo", proofText: description,
    proofChannelId, proofMessageId: "100000000000000004", publicationConsent: true,
    submittedAt: new Date("2026-10-29T11:30:00Z"), status: "SUBMITTED", rewardedAt: null,
    rewardFloors: 2, user: { discordName: "Joueur" }, ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
  vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", proofChannelId);
  vi.stubEnv("TOWER_DISCORD_GENERAL_CHANNEL_ID", generalChannelId);
  mocks.community.mockReset().mockResolvedValue({
    status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId,
  });
  mocks.attempt.mockReset().mockResolvedValue(makeAttempt());
  mocks.membership.mockReset().mockResolvedValue({ status: "ACTIVE" });
});
afterEach(() => vi.unstubAllEnvs());

describe("annonces The Tower", () => {
  it("ne publie pas la description dans le salon de vote avant la réussite", async () => {
    const result = await towerChallengeAnnounceResolver.resolve(input("proof"));
    if (!result.eligible) throw new Error("La preuve consentie et encore ouverte doit être proposée au vote.");
    if (result.action.kind !== "send_channel_message_verified") throw new Error("Une annonce de preuve doit être envoyée.");
    expect(result.action.message.content).toContain("https://discord.com/channels/" + guildId + "/" + proofChannelId);
    expect(result.action.message.content).not.toContain(description);
    expect(result.action.message.allowedMentions).toEqual({ parse: [] });
  });

  it("présente une preuve au vote sans partager le texte au général", async () => {
    mocks.attempt.mockResolvedValueOnce(makeAttempt({ publicationConsent: false }));
    const result = await towerChallengeAnnounceResolver.resolve(input("proof"));
    if (!result.eligible) throw new Error("Une preuve sans partage général doit rester soumise au vote communautaire.");
    if (result.action.kind !== "send_channel_message_verified") throw new Error("Une annonce de preuve doit être envoyée.");
    expect(result.action.message.content).toContain("https://discord.com/channels/" + guildId + "/" + proofChannelId);
    expect(result.action.message.content).not.toContain(description);
  });

  it("ne partage pas une tentative sans consentement", async () => {
    mocks.attempt.mockResolvedValueOnce(makeAttempt({ publicationConsent: false }));
    const result = await towerChallengeAnnounceResolver.resolve(input("success"));
    expect(result).toMatchObject({ eligible: false, reason: "expired" });
  });

  it("ne publie la description dans le général qu’après une réussite récompensée", async () => {
    mocks.attempt.mockResolvedValueOnce(makeAttempt({
      status: "APPROVED",
      rewardedAt: new Date("2026-10-29T11:55:00Z"),
    }));
    const result = await towerChallengeAnnounceResolver.resolve(input("success"));
    if (!result.eligible) throw new Error("Une réussite consentie et récompensée doit pouvoir être annoncée.");
    if (result.action.kind !== "send_channel_message_verified") throw new Error("Une annonce de réussite doit être envoyée.");
    expect(result.action.message.content).toContain(description);
    expect(result.action.message.allowedMentions).toEqual({ parse: [] });
  });

  it("annonce une réussite d'équipe comme des récompenses personnelles sans score d'équipe doublé", async () => {
    mocks.attempt.mockResolvedValueOnce(makeAttempt({
      teamId: "team_1", team: { name: "Les grimpeurs" },
      participants: [{ rewardedAt: new Date("2026-10-29T11:55:00Z") }, { rewardedAt: null }],
      status: "APPROVED", rewardedAt: new Date("2026-10-29T11:55:00Z"),
    }));
    const result = await towerChallengeAnnounceResolver.resolve(input("success"));
    if (!result.eligible || result.action.kind !== "send_channel_message_verified") throw new Error("L'équipe consentante doit pouvoir être annoncée après validation.");
    expect(result.action.message.content).toContain("L’équipe **Les grimpeurs**");
    expect(result.action.message.content).toContain("parcours personnel");
    expect(result.action.message.content).toContain("deux réussites quotidiennes communes");
    expect(result.action.message.content).not.toContain("score d'équipe");
  });
});
