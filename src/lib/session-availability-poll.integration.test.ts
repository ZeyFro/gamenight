import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[availability-polls] Postgres local absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("sondages privés de disponibilités (Postgres local)", () => {
  let db: import("@prisma/client").PrismaClient;
  let polls: typeof import("./session-availability-poll-data");
  let creator: { id: string }, guest: { id: string }, outsider: { id: string }, bOnly: { id: string };
  let community: { id: string }, otherCommunity: { id: string };
  let serial = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    polls = await import("./session-availability-poll-data");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Session", "NotificationEvent", "NotificationDelivery" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tout accès réseau est interdit dans cette intégration."); }));
    community = await db.community.create({ data: { slug: "default", name: "Défaut", status: "ACTIVE" } });
    otherCommunity = await db.community.create({ data: { slug: "serveur-b", name: "Serveur B", status: "ACTIVE" } });
    const makeUser = () => db.user.create({ data: { discordId: `poll-user-${++serial}`, discordName: `Joueur ${serial}` } });
    creator = await makeUser(); guest = await makeUser(); outsider = await makeUser();
    bOnly = await makeUser();
    await db.membership.createMany({ data: [creator, guest, outsider].map(user => ({ communityId: community.id, userId: user.id, status: "ACTIVE" })) });
    await db.membership.create({ data: { communityId: otherCommunity.id, userId: bOnly.id, status: "ACTIVE" } });
  }, 30_000);
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function input() {
    const { wallClockNow, toDateInputValue } = await import("./wallclock");
    const day = toDateInputValue(new Date(wallClockNow().getTime() + 7 * 86_400_000));
    return { title: "Choisissons vendredi", participantIds: [creator.id, guest.id], options: [
      { date: day, time: "20:00", durationMinutes: 120 },
      { date: day, time: "22:00", durationMinutes: 120 },
    ] };
  }
  async function create() {
    const { id } = await polls.createAvailabilityPoll(creator.id, await input());
    return polls.loadAvailabilityPoll(creator.id, id);
  }

  it("rejoue une création avec la même clé sans dupliquer et ne ressuscite pas un sondage supprimé", async () => {
    const creationKey = `poll-create-${++serial}-key`;
    const payload = await input();
    const first = await polls.createAvailabilityPoll(creator.id, payload, creationKey);
    const replay = await polls.createAvailabilityPoll(creator.id, payload, creationKey);
    expect(replay).toMatchObject({ id: first.id, replayed: true });
    expect(await db.sessionAvailabilityPoll.count()).toBe(1);
    const form = new FormData();
    form.set("creationKey", creationKey);
    const { resumeCreation } = await import("./creation-resume");
    expect(await resumeCreation(creator.id, "AVAILABILITY_POLL", form)).toBe(`/sessions/sondages/${first.id}`);
    await db.sessionAvailabilityPoll.delete({ where: { id: first.id } });
    await expect(resumeCreation(creator.id, "AVAILABILITY_POLL", form)).rejects.toThrow();
  });

  it("crée options et participants atomiquement sans soirée, MP, rappel ni récompense", async () => {
    const poll = await create();
    expect(poll.participants.map(row => row.userId).sort()).toEqual([creator.id, guest.id].sort());
    expect(poll.slots).toHaveLength(2);
    expect(poll.communityId).toBe(community.id);
    expect(await db.session.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
    expect(await db.xpEvent.count()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("isolation OFF : refuse un participant B-only dans un sondage A, sans écrire", async () => {
    const payload = await input();
    payload.participantIds.push(bOnly.id);

    await expect(polls.createAvailabilityPoll(creator.id, payload)).rejects.toThrow(polls.AvailabilityPollError);
    expect(await db.sessionAvailabilityPoll.count()).toBe(0);
    expect(await db.sessionAvailabilityPollParticipant.count({ where: { userId: bOnly.id } })).toBe(0);
  });

  it("isolation OFF : bloque la conversion si un participant A est devenu B-only", async () => {
    const poll = await create();
    await db.sessionAvailabilityPollParticipant.deleteMany({ where: { pollId: poll.id } });
    await db.sessionAvailabilityPollParticipant.create({ data: { pollId: poll.id, userId: bOnly.id } });

    await expect(polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id)).rejects.toThrow(polls.AvailabilityPollError);
    expect(await db.session.count()).toBe(0);
    expect((await polls.loadAvailabilityPoll(creator.id, poll.id)).status).toBe("OPEN");
  });

  it("refuse un ID connu à un non-participant, y compris isolation OFF", async () => {
    const poll = await create();
    expect((await polls.loadAvailabilityPoll(guest.id, poll.id)).id).toBe(poll.id);
    await expect(polls.loadAvailabilityPoll(outsider.id, poll.id)).rejects.toThrow(polls.AvailabilityPollError);
    expect(await polls.listAvailabilityPolls(outsider.id)).toEqual([]);
    await expect(polls.answerAvailabilityPoll(outsider.id, poll.id, poll.slots[0].id, "AVAILABLE")).rejects.toThrow();
  });

  it("réponse personnelle idempotente, modifiable et effaçable ; aucun vote implicite", async () => {
    const poll = await create(), slot = poll.slots[0];
    expect(slot.responses).toEqual([]);
    await polls.answerAvailabilityPoll(guest.id, poll.id, slot.id, "AVAILABLE");
    await polls.answerAvailabilityPoll(guest.id, poll.id, slot.id, "AVAILABLE");
    await polls.answerAvailabilityPoll(guest.id, poll.id, slot.id, "MAYBE");
    expect(await db.sessionAvailabilityPollResponse.findMany()).toMatchObject([{ userId: guest.id, answer: "MAYBE" }]);
    await polls.answerAvailabilityPoll(guest.id, poll.id, slot.id, null);
    expect(await db.sessionAvailabilityPollResponse.count()).toBe(0);
  });

  it("refuse créneau d'un autre sondage, réponse malformée et choix par un invité", async () => {
    const first = await create(), second = await create();
    await expect(polls.answerAvailabilityPoll(guest.id, first.id, second.slots[0].id, "AVAILABLE")).rejects.toThrow();
    await expect(polls.answerAvailabilityPoll(guest.id, first.id, first.slots[0].id, { answer: "AVAILABLE", userId: creator.id })).rejects.toThrow();
    await expect(polls.chooseAvailabilityPollSlot(guest.id, first.id, first.slots[0].id)).rejects.toThrow();
    expect(await db.session.count()).toBe(0);
  });

  it("refuse un participant révoqué même OFF, ainsi qu'une conversion qui l'inclurait", async () => {
    const poll = await create();
    await db.membership.create({ data: { communityId: community.id, userId: guest.id, status: "REMOVED" } });
    await expect(polls.loadAvailabilityPoll(guest.id, poll.id)).rejects.toThrow();
    expect(await polls.listAvailabilityPolls(guest.id)).toEqual([]);
    await expect(polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id)).rejects.toThrow();
    expect(await db.session.count()).toBe(0);
    expect((await polls.loadAvailabilityPoll(creator.id, poll.id)).status).toBe("OPEN");
  });

  it("garde le sondage et les invitations dans la communauté active sous isolation ON", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    const poll = await create();
    expect(poll.communityId).toBe(community.id);
    await expect(polls.loadAvailabilityPoll(outsider.id, poll.id)).rejects.toThrow();
    await expect(polls.answerAvailabilityPoll(outsider.id, poll.id, poll.slots[0].id, "AVAILABLE")).rejects.toThrow();
    const { session } = await polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id);
    expect(session.communityId).toBe(community.id);
    expect(await db.sessionInvite.findMany({ where: { sessionId: session.id }, select: { userId: true } })).toEqual([{ userId: guest.id }]);
  });

  it("deux choix concurrents créent une seule soirée avec invitations exactes et vraie deadline", async () => {
    const poll = await create();
    const results = await Promise.all([
      polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id),
      polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[1].id),
    ]);
    expect(new Set(results.map(row => row.session.id)).size).toBe(1);
    expect(results.filter(row => row.replayed)).toHaveLength(1);
    expect(await db.session.count()).toBe(1);
    expect(await db.sessionInvite.findMany()).toMatchObject([{ userId: guest.id, sessionId: results[0].session.id }]);
    expect(await db.notification.findMany({ where: { relatedSessionId: results[0].session.id }, select: { userId: true, communityId: true } })).toEqual([{ userId: guest.id, communityId: community.id }]);
    expect(results[0].session.communityId).toBe(community.id);
    expect(results[0].session.votingDeadline).not.toBeNull();
    expect(results[0].session.votingDeadline!.getTime()).toBeLessThan(results[0].session.date.getTime());
    await expect(polls.answerAvailabilityPoll(guest.id, poll.id, poll.slots[0].id, "AVAILABLE")).rejects.toThrow();
    await db.membership.create({ data: { communityId: community.id, userId: guest.id, status: "REMOVED" } });
    const replay = await polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id);
    expect(replay).toMatchObject({ replayed: true, session: { id: results[0].session.id } });
  });

  it("clôture réservée au créateur et course réponse/clôture sérialisée", async () => {
    const poll = await create();
    await expect(polls.closeAvailabilityPoll(guest.id, poll.id)).rejects.toThrow();
    const results = await Promise.allSettled([
      polls.answerAvailabilityPoll(guest.id, poll.id, poll.slots[0].id, "AVAILABLE"),
      polls.closeAvailabilityPoll(creator.id, poll.id),
    ]);
    expect(results[1].status).toBe("fulfilled");
    expect((await polls.loadAvailabilityPoll(guest.id, poll.id)).status).toBe("CLOSED");
    const { session } = await polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id);
    expect(session.communityId).toBe(community.id);
    expect((await polls.loadAvailabilityPoll(creator.id, poll.id)).status).toBe("CLOSED");
  });

  it("respecte la préférence SESSION et ne permet pas de recréer après suppression de la soirée", async () => {
    const poll = await create();
    await db.userNotificationPreference.create({ data: { userId: guest.id, category: "SESSION", enabled: false } });
    const { session } = await polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id);
    expect(await db.notification.count({ where: { relatedSessionId: session.id } })).toBe(0);
    await db.session.delete({ where: { id: session.id } });
    await expect(polls.chooseAvailabilityPollSlot(creator.id, poll.id, poll.slots[0].id)).rejects.toThrow();
    expect(await db.session.count()).toBe(0);
  });

  it("les FK refusent réponse/choix étrangers, puis permettent de supprimer un sondage avec choix", async () => {
    const first = await create(), second = await create();
    await expect(db.sessionAvailabilityPollResponse.create({ data: {
      pollId: first.id, slotId: second.slots[0].id, userId: guest.id, answer: "AVAILABLE",
    } })).rejects.toThrow();
    await expect(db.sessionAvailabilityPollResponse.create({ data: {
      pollId: first.id, slotId: first.slots[0].id, userId: outsider.id, answer: "AVAILABLE",
    } })).rejects.toThrow();
    await expect(db.sessionAvailabilityPoll.update({ where: { id: first.id }, data: { chosenSlotId: second.slots[0].id } })).rejects.toThrow();
    await polls.chooseAvailabilityPollSlot(creator.id, first.id, first.slots[0].id);
    await db.sessionAvailabilityPoll.delete({ where: { id: first.id } });
    expect(await db.sessionAvailabilityPollSlot.count({ where: { pollId: first.id } })).toBe(0);
    expect(await db.session.count()).toBe(1);
  });
});
