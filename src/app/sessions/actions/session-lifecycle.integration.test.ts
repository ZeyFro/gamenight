import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chantier confidentialité des soirées — preuve d'intégration Postgres
 * réelle que `createSession` (chemin de création CLASSIQUE, par
 * opposition aux deux chemins roulette déjà couverts par
 * session-announce.integration.test.ts) persiste des `SessionInvite`
 * EXACTS pour la sélection du créateur, ATOMIQUEMENT avec la session —
 * jamais une liste vide transformée en "tout le monde", jamais un invité
 * de plus ou de moins que ce qui a été explicitement coché au formulaire.
 *
 * Nécessite `TEST_DATABASE_URL` — voir le README. Suite entièrement
 * SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[session-lifecycle.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "La preuve que createSession persiste des SessionInvite exacts n'est PAS validée."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("createSession — invitations exactes (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let currentUserMock: ReturnType<typeof vi.fn>;
  let createSession: typeof import("./session-lifecycle").createSession;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;

    currentUserMock = vi.fn();
    vi.doMock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));

    ({ createSession } = await import("./session-lifecycle"));
  });

  afterAll(async () => {
    await db.$disconnect();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  beforeEach(async () => {
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans cette intégration."); }));
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionInvite", "Vote", "Proposal", "Session", "XpEvent", "User" CASCADE`
    );
    vi.clearAllMocks();
    redirectMock.mockImplementation((location: string) => {
      throw new Error(`REDIRECT:${location}`);
    });
  });

  let counter = 0;
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser() {
    const id = uniq("user");
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: {
      userId: user.id,
      communityId: await (await import("@/lib/default-community")).getDefaultCommunityId(),
      status: "ACTIVE",
    } });
    return user;
  }

  function formData(fields: Record<string, string | string[]>): FormData {
    const fd = new FormData();
    fd.set("creationKey", crypto.randomUUID());
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const v of value) fd.append(key, v);
      } else {
        fd.set(key, value);
      }
    }
    return fd;
  }

  it("plafond anti-farm : la 4e soirée créée en 24 h existe mais ne rapporte pas d'XP de création", async () => {
    await db.community.upsert({ where: { slug: "default" }, update: { status: "ACTIVE" }, create: { slug: "default", name: "default", status: "ACTIVE" } });
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    const creator = await makeUser();
    currentUserMock.mockResolvedValue(creator);
    for (let day = 1; day <= 4; day++) {
      await expect(
        createSession(formData({ date: `2026-11-0${day}`, time: "20:00" }))
      ).rejects.toThrow(/^REDIRECT:\/sessions\//);
    }
    expect(await db.session.count({ where: { createdById: creator.id } })).toBe(4);
    expect(await db.xpEvent.count({ where: { userId: creator.id, reason: "CREATE_SESSION" } })).toBe(3);
  });

  it.each([false, true])("crée une série mensuelle atomique et rejoue la même intention sans dupliquer les occurrences (gestion groupée %s)", async (enabled) => {
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", String(enabled));
    await db.community.upsert({ where: { slug: "default" }, update: { status: "ACTIVE" }, create: { slug: "default", name: "default", status: "ACTIVE" } });
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    const creator = await makeUser();
    currentUserMock.mockResolvedValue(creator);
    const form = formData({ date: "2026-11-07", time: "20:00", recurrence: "monthly", recurrenceCount: "4", recurrenceGroupId: "forged" });

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(createSession(form)).rejects.toThrow(/^REDIRECT:\/sessions\//);
    }

    const sessions = await db.session.findMany({ where: { createdById: creator.id }, orderBy: { date: "asc" } });
    expect(sessions.map((session) => session.date.toISOString())).toEqual([
      "2026-11-07T20:00:00.000Z", "2026-12-05T20:00:00.000Z",
      "2027-01-02T20:00:00.000Z", "2027-02-06T20:00:00.000Z",
    ]);
    expect(new Set(sessions.map((session) => session.recurrenceGroupId)).size).toBe(1);
    if (enabled) {
      expect(sessions[0].recurrenceGroupId).toMatch(/^[0-9a-f-]{36}$/);
      expect(sessions[0].recurrenceGroupId).not.toBe("forged");
    } else expect(sessions.every((session) => session.recurrenceGroupId === null)).toBe(true);
  });

  it("persiste EXACTEMENT les potes cochés — jamais plus, jamais moins, jamais 'tout le monde'", async () => {
    const creator = await makeUser();
    const invitedA = await makeUser();
    const invitedB = await makeUser();
    const notInvited = await makeUser();
    currentUserMock.mockResolvedValue(creator);

    await expect(
      createSession(
        formData({
          date: "2026-11-01",
          time: "20:00",
          notifyUserId: [invitedA.id, invitedB.id],
        })
      )
    ).rejects.toThrow(/^REDIRECT:\/sessions\//);

    const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
    const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
    expect(invites.map((i) => i.userId).sort()).toEqual([invitedA.id, invitedB.id].sort());
    expect(invites.every((i) => i.status === "ACTIVE")).toBe(true);
    expect(invites.every((i) => i.invitedById === creator.id)).toBe(true);
    expect(invites.map((i) => i.userId)).not.toContain(notInvited.id);
    expect(invites.map((i) => i.userId)).not.toContain(creator.id);

    // Le créateur a accès sans ligne dédiée, `notInvited` n'en a aucune.
    const access = await import("@/lib/session-access");
    expect(await access.canAccessSession(creator.id, session.id)).toBe(true);
    expect(await access.canAccessSession(invitedA.id, session.id)).toBe(true);
    expect(await access.canAccessSession(notInvited.id, session.id)).toBe(false);
  });

  it("aucun pote coché — la session reste accessible au SEUL créateur, jamais un repli vers 'tout le monde'", async () => {
    const creator = await makeUser();
    const someoneElse = await makeUser();
    currentUserMock.mockResolvedValue(creator);

    await expect(
      createSession(formData({ date: "2026-11-01", time: "20:00" }))
    ).rejects.toThrow(/^REDIRECT:\/sessions\//);

    const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
    expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(0);

    const access = await import("@/lib/session-access");
    expect(await access.canAccessSession(creator.id, session.id)).toBe(true);
    expect(await access.canAccessSession(someoneElse.id, session.id)).toBe(false);
  });

  it("l'écriture groupée exclut le créateur et déduplique les destinataires sans élargir l'accès", async () => {
    const creator = await makeUser();
    const friend = await makeUser();
    currentUserMock.mockResolvedValue(creator);
    await expect(createSession(formData({ date: "2026-11-01", time: "20:00",
      notifyUserId: [creator.id, friend.id, friend.id],
    }))).rejects.toThrow(/^REDIRECT:\/sessions\//);
    const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
    const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
    expect(invites.map((invite) => invite.userId)).toEqual([friend.id]);
    expect(invites[0].invitedById).toBe(creator.id);
    expect(currentUserMock).toHaveBeenCalledWith({ recordActivity: false });
  });

  it("un id de pote forgé/inexistant dans la sélection est silencieusement ignoré — jamais une ligne SessionInvite orpheline", async () => {
    const creator = await makeUser();
    const real = await makeUser();
    currentUserMock.mockResolvedValue(creator);

    await expect(
      createSession(
        formData({
          date: "2026-11-01",
          time: "20:00",
          notifyUserId: [real.id, "id-invente-qui-nexiste-pas"],
        })
      )
    ).rejects.toThrow(/^REDIRECT:\/sessions\//);

    const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
    const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
    expect(invites.map((i) => i.userId)).toEqual([real.id]);
  });

  /**
   * Complément au diagnostic — bug remonté en test réel : un invité coché
   * SUR LE FORMULAIRE DE CRÉATION avait bien sa ligne `SessionInvite`
   * (tests ci-dessus) mais aucune synchronisation Discord n'était jamais
   * enqueue-ée pour lui (seul `addSessionInviteAction`, l'ajout MANUEL
   * après création, le faisait) — jamais ajouté au fil privé tant que le
   * créateur ne le réinvitait pas explicitement depuis la page invités.
   * Preuve directe que `createSession` enqueue désormais une livraison
   * `invite:<id>` PAR invité créé, EN PLUS de `thread`/`announce`/
   * `creator-member` — jamais un doublon, jamais un invité oublié.
   */
  describe.skipIf(!TEST_DATABASE_URL)(
    "synchronisation Discord des invités choisis À LA CRÉATION (bot activé)",
    () => {
      beforeEach(() => {
        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
        vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
        vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
      });

      afterAll(() => {
        vi.unstubAllEnvs();
      });

      it("une livraison invite-sync est enqueue-ée pour CHAQUE invité coché à la création, en plus de thread/announce/creator-member", async () => {
        const creator = await makeUser();
        const invitedA = await makeUser();
        const invitedB = await makeUser();
        currentUserMock.mockResolvedValue(creator);

        await expect(
          createSession(
            formData({
              date: "2026-11-01",
              time: "20:00",
              notifyUserId: [invitedA.id, invitedB.id],
            })
          )
        ).rejects.toThrow(/^REDIRECT:\/sessions\//);

        const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
        const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
        expect(invites).toHaveLength(2);

        // `targetSlot` réel : `default-guild:SESSION:<sessionId>:<role>`, où
        // `<role>` peut lui-même contenir des ":" (ex. `invite:<inviteId>`)
        // — on retire le préfixe connu plutôt que de `split(":")`, qui
        // tronquerait `invite:<id>` à son seul id.
        const prefix = `default-guild:SESSION:${session.id}:`;
        const deliveries = await db.notificationDelivery.findMany({});
        const sessionDeliveries = deliveries.filter((d) => d.targetSlot.startsWith(prefix));
        const roles = sessionDeliveries.map((d) => d.targetSlot.slice(prefix.length));
        expect(roles).toContain("thread");
        expect(roles).toContain("announce");
        expect(roles).toContain("creator-member");
        for (const invite of invites) {
          expect(roles.filter((r) => r === `invite:${invite.id}`)).toHaveLength(1);
        }
        expect(sessionDeliveries).toHaveLength(5); // thread + announce + creator-member + 2 invite-sync
      });

      it("neuf invités : neuf livraisons invite-sync, chacune avec son événement et la communauté de la soirée", async () => {
        const creator = await makeUser();
        const guests = [];
        for (let i = 0; i < 9; i++) guests.push(await makeUser());
        currentUserMock.mockResolvedValue(creator);

        await expect(
          createSession(formData({ date: "2026-11-01", time: "20:00", notifyUserId: guests.map((g) => g.id) }))
        ).rejects.toThrow(/^REDIRECT:\/sessions\//);

        const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
        const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
        expect(invites).toHaveLength(9);
        const syncEvents = await db.notificationEvent.findMany({
          where: { eventType: "SESSION_INVITE_SYNC", sourceId: session.id },
        });
        expect(syncEvents).toHaveLength(9);
        expect(new Set(syncEvents.map((e) => e.occurrence)).size).toBe(9);
        expect(syncEvents.every((e) => e.communityId === session.communityId)).toBe(true);
        const prefix = `default-guild:SESSION:${session.id}:invite:`;
        const deliveries = (await db.notificationDelivery.findMany({})).filter((d) => d.targetSlot.startsWith(prefix));
        expect(deliveries.map((d) => d.targetSlot.slice(prefix.length)).sort()).toEqual(invites.map((i) => i.id).sort());
        for (const delivery of deliveries) {
          expect(delivery).toMatchObject({ status: "PENDING", operation: "SEND", transport: "BOT", channel: "DISCORD_CHANNEL" });
          expect(syncEvents.some((e) => e.id === delivery.eventId)).toBe(true);
        }
      });

      it("aucun invité coché — aucune livraison invite-sync, seulement thread/announce/creator-member", async () => {
        const creator = await makeUser();
        currentUserMock.mockResolvedValue(creator);

        await expect(
          createSession(formData({ date: "2026-11-01", time: "20:00" }))
        ).rejects.toThrow(/^REDIRECT:\/sessions\//);

        const session = await db.session.findFirstOrThrow({ where: { createdById: creator.id } });
        const prefix = `default-guild:SESSION:${session.id}:`;
        const deliveries = await db.notificationDelivery.findMany({});
        const sessionDeliveries = deliveries.filter((d) => d.targetSlot.startsWith(prefix));
        const roles = sessionDeliveries.map((d) => d.targetSlot.slice(prefix.length));
        expect(roles.sort()).toEqual(["announce", "creator-member", "thread"].sort());
      });
    }
  );
});
