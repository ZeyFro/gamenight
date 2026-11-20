import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  attempt: vi.fn(),
  voteCount: vi.fn(),
  delivery: vi.fn(),
  event: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({
    community: { findUnique: mocks.community },
    towerChallengeAttempt: { findFirst: mocks.attempt },
    towerChallengeVote: { count: mocks.voteCount },
    notificationDelivery: { findFirst: mocks.delivery },
  }),
}));
vi.mock("@/lib/notification-delivery", () => ({
  createNotificationEvent: mocks.event,
  enqueueDelivery: mocks.enqueue,
}));
import { refreshTowerProofMessage, towerChallengeAnnounceResolver, TOWER_PROOF_THREAD, TOWER_PROOF_VOTE_UPDATED } from "./tower-challenge-announcements";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const attemptId = "attempt_123";
const messageRef = { discordMessageId: "100000000000000009", discordChannelId: channelId, discordThreadId: null };
const submittedAt = new Date("2026-12-10T10:00:00Z");

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId, userId: "author", title: "Défi du jour", status: "SUBMITTED", submittedAt, voteExtendedAt: null,
    quorumResubmissions: 0, proofChannelId: channelId, proofMessageId: "100000000000000004", teamId: null, team: null,
    participants: [], user: { discordName: "Joueur" }, ...overrides,
  };
}
function request(eventType: string, operation: "SEND" | "EDIT", targetSlot: string, now = new Date("2026-12-10T12:00:00Z"), targetMessage: unknown = messageRef) {
  return {
    event: { category: "ACHIEVEMENT", eventType, communityId: "community_1", sourceId: attemptId },
    delivery: { channel: "DISCORD_CHANNEL", transport: "BOT", operation, recipientKey: channelId, targetSlot, targetMessage },
    now,
  } as unknown as Parameters<typeof towerChallengeAnnounceResolver.resolve>[0];
}
const proofSlot = guildId + ":TOWER:" + attemptId + ":proof";

beforeEach(() => {
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
  vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", channelId);
  vi.stubEnv("TOWER_DISCORD_GENERAL_CHANNEL_ID", "100000000000000003");
  mocks.community.mockReset().mockResolvedValue({ status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId });
  mocks.attempt.mockReset().mockResolvedValue(attempt());
  mocks.voteCount.mockReset().mockResolvedValue(2);
  mocks.delivery.mockReset().mockResolvedValue({ id: "d1" });
  mocks.event.mockReset().mockResolvedValue({ id: "e1" });
  mocks.enqueue.mockReset().mockResolvedValue({ id: "q1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("édition du message public de vote", () => {
  it("affiche le nombre de votants sans détailler le sens des votes, avec les boutons ✅/❌", async () => {
    const result = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot));
    if (!result.eligible || result.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(result.action.messageId).toBe(messageRef.discordMessageId);
    expect(result.action.message.content).toContain("**2** votant(s)");
    expect(result.action.message.content).toContain("modifiable jusqu’à l’échéance");
    expect(result.action.message.allowedMentions).toEqual({ parse: [] });
    const labels = result.action.message.components?.[0].components.map(button => button.label);
    expect(labels).toEqual(["✅ Valider", "❌ Refuser"]);
  });

  it("n'inclut dans le compteur ni l'auteur ni les participants de l'équipe", async () => {
    mocks.attempt.mockResolvedValue(attempt({ teamId: "t", team: { name: "Équipe" }, participants: [{ userId: "p1" }, { userId: "p2" }] }));
    await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot));
    expect(mocks.voteCount).toHaveBeenCalledWith({ where: { communityId: "community_1", attemptId, userId: { notIn: ["author", "p1", "p2"] } } });
  });

  it("affiche la prolongation unique et retire les boutons une fois l'échéance passée", async () => {
    mocks.attempt.mockResolvedValue(attempt({ voteExtendedAt: new Date("2026-12-11T10:00:00Z") }));
    const extended = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot, new Date("2026-12-11T12:00:00Z")));
    if (!extended.eligible || extended.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(extended.action.message.components).toHaveLength(1);
    expect(extended.action.message.content).toContain("<t:" + Math.floor(new Date("2026-12-12T10:00:00Z").getTime() / 1000) + ":f>");
    const closed = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot, new Date("2026-12-12T10:00:01Z")));
    if (!closed.eligible || closed.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(closed.action.message.components).toEqual([]);
  });

  it("retire les boutons et annonce l'issue après règlement", async () => {
    mocks.attempt.mockResolvedValue(attempt({ status: "APPROVED" }));
    const approved = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot));
    if (!approved.eligible || approved.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(approved.action.message.content).toContain("Preuve validée");
    expect(approved.action.message.components).toEqual([]);
    mocks.attempt.mockResolvedValue(attempt({ status: "REJECTED" }));
    const rejected = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot));
    if (!rejected.eligible || rejected.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(rejected.action.message.content).toContain("Preuve refusée");
  });

  it("ferme l'ancien message d'une preuve resoumise après un rejet sans quorum", async () => {
    mocks.attempt.mockResolvedValue(attempt({ status: "ASSIGNED", submittedAt: null, proofChannelId: null, proofMessageId: null, quorumResubmissions: 1 }));
    const result = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot));
    if (!result.eligible || result.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(result.action.message.content).toContain("sans quorum");
    expect(result.action.message.components).toEqual([]);
  });

  it("refuse un créneau qui n'est pas celui de la preuve, un drapeau éteint et une référence absente", async () => {
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot + "-autre"))).toMatchObject({ eligible: false, reason: "unresolvable" });
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "SEND", proofSlot))).toMatchObject({ eligible: false, reason: "unresolvable" });
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot, undefined, null))).toMatchObject({ eligible: false, reason: "dependency_not_ready" });
    vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "false");
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_VOTE_UPDATED, "EDIT", proofSlot))).toMatchObject({ eligible: false, reason: "unresolvable" });
  });
});

describe("fil par preuve", () => {
  const threadSlot = guildId + ":TOWER:" + attemptId + ":proof-thread";

  it("crée le fil depuis le message public déjà posté", async () => {
    mocks.delivery.mockResolvedValue({ discordMessageId: messageRef.discordMessageId, discordChannelId: channelId });
    const result = await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_THREAD, "SEND", threadSlot, undefined, null));
    if (!result.eligible || result.action.kind !== "create_thread") throw new Error("Création de fil attendue");
    expect(result.action).toMatchObject({ channelId, messageId: messageRef.discordMessageId });
    expect(result.action.name).toContain("Défi du jour");
    expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ targetSlot: proofSlot, status: "SENT" }) }));
  });

  it("attend l'annonce publique et n'ouvre pas de fil pour une preuve plus en vote", async () => {
    mocks.delivery.mockResolvedValue(null);
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_THREAD, "SEND", threadSlot, undefined, null))).toMatchObject({ eligible: false, reason: "dependency_not_ready" });
    mocks.attempt.mockResolvedValue(attempt({ status: "APPROVED" }));
    expect(await towerChallengeAnnounceResolver.resolve(request(TOWER_PROOF_THREAD, "SEND", threadSlot, undefined, null))).toMatchObject({ eligible: false, reason: "expired" });
  });
});

describe("mise en file de la mise à jour", () => {
  const tx = { community: { findUnique: mocks.community }, towerChallengeAttempt: { findFirst: mocks.attempt }, notificationDelivery: { findFirst: mocks.delivery } };
  const run = (round?: number) => refreshTowerProofMessage(tx as never, "community_1", attemptId, round);

  it("met en file une édition sur le créneau de la preuve, jamais un nouveau message", async () => {
    expect(await run()).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ operation: "EDIT", targetSlot: proofSlot, recipientKey: channelId }), tx);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: TOWER_PROOF_VOTE_UPDATED, sourceId: attemptId }), tx);
  });

  it("ne fait rien sans annonce existante, drapeau éteint ou serveur différent", async () => {
    mocks.delivery.mockResolvedValue(null);
    expect(await run()).toBe(false);
    mocks.delivery.mockResolvedValue({ id: "d1" });
    mocks.community.mockResolvedValue({ status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: "999999999999999999" });
    expect(await run()).toBe(false);
    mocks.community.mockResolvedValue({ status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId });
    vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "false");
    expect(await run()).toBe(false);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("vise le créneau de l'ancienne soumission quand un rang est donné", async () => {
    await run(0);
    mocks.attempt.mockResolvedValue({ quorumResubmissions: 1 });
    await run();
    expect(mocks.enqueue.mock.calls.map(call => call[0].targetSlot)).toEqual([proofSlot, proofSlot + ":r1"]);
  });
});
