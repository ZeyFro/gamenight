import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AccountBlobOps } from "@/lib/account-deletion";

/**
 * Suppression et export de compte (ACCOUNT_DELETION_ENABLED, docs/SUPPRESSION_COMPTE.md) : intégration Postgres
 * isolée (réel moteur : les clés étrangères Restrict/NoAction et les cascades sont ce qu'on teste). Aucun appel
 * réseau : Vercel Blob est mocké et injecté, Discord n'est jamais appelé.
 *
 * Nécessite `TEST_DATABASE_URL` (Postgres local, jamais Neon) — voir docs/DEVELOPPEMENT_LOCAL.md. Suite entièrement
 * SKIPPÉE si absente : la garantie d'effacement n'est alors PAS validée par cette exécution.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@vercel/blob", () => ({ del: vi.fn(), list: vi.fn(), head: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new Client({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[account-deletion.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. L'effacement N'EST PAS validé par cette exécution.");
}

const ALICE = {
  discordId: "812345678901234567",
  discordName: "AliceUnique",
  avatar: "a_avatarhash9f8e7d6c5b4a",
  accessToken: "tok-access-SECRET-alice-1234",
  refreshToken: "tok-refresh-SECRET-alice-5678",
  steamId64: "76561198000000001",
  psnId: "alice_psn_unique",
  pushEndpoint: "https://push.example/alice-endpoint-xyz",
  p256dh: "p256dh-alice-xyz-key",
  pushAuth: "auth-alice-xyz-secret",
  email: "alice@example.invalid",
};
const BOB = { discordId: "912345678901234567", discordName: "BobUnique" };
const CAROL = { discordId: "712345678901234567", discordName: "CarolUnique" };

describe.skipIf(!TEST_DATABASE_URL)("suppression de compte (intégration Postgres isolée)", () => {
  let db: PrismaClient;
  let api: typeof import("@/lib/account-deletion");
  let exportApi: typeof import("@/lib/account-export");
  let plan: typeof import("@/lib/account-deletion-plan");
  let oauth: typeof import("@/lib/community-oauth");

  const ids = {} as Record<string, string>;
  let blobOps: AccountBlobOps & { listPublicUrls: ReturnType<typeof vi.fn>; deletePublic: ReturnType<typeof vi.fn>; deletePrivate: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    api = await import("@/lib/account-deletion");
    exportApi = await import("@/lib/account-export");
    plan = await import("@/lib/account-deletion-plan");
    oauth = await import("@/lib/community-oauth");
  });

  // Tables que cette suite remplit : vidées avant ET après, pour ne laisser aucune ligne aux suites suivantes (base partagée).
  const TRUNCATE_TABLES = 'TRUNCATE "User", "Community", "Game", "Badge", "AccountDeletionLog", "CreationIntent", "XpAdjustment", "NotificationEvent", "TowerChallengeAttempt", "TowerChallengeDefinition" CASCADE';

  afterAll(async () => {
    await db.$executeRawUnsafe(TRUNCATE_TABLES);
    await db.$disconnect();
  });

  async function seed() {
    await db.$executeRawUnsafe(TRUNCATE_TABLES);
    ids.A = (await db.community.create({ data: { id: "acct-a", slug: "default", name: "Communauté A", status: "ACTIVE", discordGuildId: "111111111111111111", installedByDiscordId: ALICE.discordId } })).id;
    ids.B = (await db.community.create({ data: { id: "acct-b", slug: "b", name: "Communauté B", status: "ACTIVE", discordGuildId: "222222222222222222" } })).id;

    ids.alice = (await db.user.create({
      data: {
        discordId: ALICE.discordId, discordName: ALICE.discordName, discordAvatar: ALICE.avatar,
        discordAccessToken: ALICE.accessToken, discordRefreshToken: ALICE.refreshToken, discordTokenExpiresAt: new Date(),
        steamId64: ALICE.steamId64, psnId: ALICE.psnId, steamPublic: true, color: "#123456", colorCustomized: true,
        inputDevices: ["manette"], availablePlatforms: ["PC"], preferredGameCategories: ["coop"], xpTotal: 40, streakCount: 3,
      },
    })).id;
    await db.user.update({ where: { id: ids.alice }, data: { bannerUrl: `https://abc123.public.blob.vercel-storage.com/banners/${ids.alice}/1700000000.png` } });
    ids.bob = (await db.user.create({ data: { discordId: BOB.discordId, discordName: BOB.discordName, color: "#654321", psnId: "bob_psn" } })).id;
    ids.carol = (await db.user.create({ data: { discordId: CAROL.discordId, discordName: CAROL.discordName } })).id;

    await db.membership.createMany({
      data: [
        { communityId: ids.A, userId: ids.bob, role: "OWNER" },
        { communityId: ids.A, userId: ids.alice, role: "MEMBER" },
        { communityId: ids.B, userId: ids.carol, role: "OWNER" },
        { communityId: ids.B, userId: ids.alice, role: "ADMIN" },
      ],
    });

    ids.g1 = (await db.game.create({ data: { name: "Jeu commun", source: "MANUAL", addedById: ids.bob } })).id;
    ids.g2 = (await db.game.create({ data: { name: "Jeu ajouté par Alice", source: "MANUAL", addedById: ids.alice } })).id;
    await db.userGame.create({ data: { userId: ids.alice, gameId: ids.g1 } });
    await db.userGame.create({ data: { userId: ids.bob, gameId: ids.g1 } });
    await db.userGameLevel.create({ data: { userId: ids.alice, gameId: ids.g1, level: "COMPETITIF" } });
    await db.userProfileVisibility.create({ data: { userId: ids.alice, visibility: "HIDDEN" } });
    await db.weeklyAvailability.create({ data: { userId: ids.alice, dayOfWeek: 2, startTime: "20:00", endTime: "23:00" } });
    await db.availabilityOverride.create({ data: { userId: ids.alice, date: new Date("2026-12-01"), available: true } });

    await db.communityMemberStats.createMany({ data: [{ communityId: ids.A, userId: ids.alice, xpTotal: 100 }, { communityId: ids.A, userId: ids.bob, xpTotal: 300 }, { communityId: ids.B, userId: ids.carol, xpTotal: 50 }] });
    await db.communityMemberCosmetic.create({ data: { communityId: ids.A, userId: ids.alice, itemId: "cadre-or" } });
    await db.xpEvent.create({ data: { communityId: ids.A, userId: ids.alice, reason: "VOTE", sourceId: "src1", amount: 5 } });
    await db.xpEvent.create({ data: { communityId: ids.A, userId: ids.bob, reason: "VOTE", sourceId: "src2", amount: 5 } });

    await db.notification.create({ data: { userId: ids.alice, type: "REMINDER", title: "Pour Alice", message: "Rappel privé", communityId: ids.A } });
    await db.notification.create({ data: { userId: ids.bob, type: "REVANCHE", title: "Mention", message: `${ALICE.discordName} n'a jamais gagné au Jeu commun`, communityId: ids.A } });
    await db.notification.create({ data: { userId: ids.bob, type: "REMINDER", title: "Sans rapport", message: "Rien à voir avec personne", communityId: ids.A } });
    await db.webPushSubscription.create({ data: { userId: ids.alice, endpoint: ALICE.pushEndpoint, p256dh: ALICE.p256dh, auth: ALICE.pushAuth } });
    await db.calendarFeedToken.create({ data: { userId: ids.alice, communityId: ids.A, tokenHash: "a".repeat(64) } });

    const aliceMessage = await db.chatMessage.create({ data: { userId: ids.alice, content: "Salut c'est Alice", communityId: ids.A } });
    const bobMessage = await db.chatMessage.create({ data: { userId: ids.bob, content: "Salut c'est Bob", communityId: ids.A } });
    await db.chatReaction.create({ data: { messageId: aliceMessage.id, userId: ids.bob, emoji: "👍" } });
    await db.chatReaction.create({ data: { messageId: bobMessage.id, userId: ids.alice, emoji: "🔥" } });

    const date = new Date(Date.now() + 86_400_000);
    ids.s1 = (await db.session.create({ data: { date, createdById: ids.alice, communityId: ids.A, status: "DONE" } })).id;
    ids.s2 = (await db.session.create({ data: { date, createdById: ids.bob, communityId: ids.A } })).id;
    ids.sb = (await db.session.create({ data: { date, createdById: ids.carol, communityId: ids.B } })).id;
    const p1 = await db.proposal.create({ data: { sessionId: ids.s1, gameId: ids.g1, proposedById: ids.alice } });
    const p2 = await db.proposal.create({ data: { sessionId: ids.s2, gameId: ids.g1, proposedById: ids.bob } });
    await db.vote.create({ data: { proposalId: p1.id, userId: ids.bob } });
    await db.vote.create({ data: { proposalId: p2.id, userId: ids.alice } });
    await db.vote.create({ data: { proposalId: p2.id, userId: ids.bob } });
    await db.sessionInvite.create({ data: { sessionId: ids.s1, userId: ids.bob, invitedById: ids.alice } });
    await db.sessionInvite.create({ data: { sessionId: ids.s2, userId: ids.alice, invitedById: ids.bob } });
    await db.sessionInvite.create({ data: { sessionId: ids.sb, userId: ids.alice, invitedById: ids.carol } });
    await db.sessionResult.create({ data: { sessionId: ids.s1, userId: ids.alice, placement: 1, communityId: ids.A } });
    await db.sessionResult.create({ data: { sessionId: ids.s1, userId: ids.bob, placement: 2, communityId: ids.A } });
    await db.sessionAttendance.create({ data: { sessionId: ids.s1, communityId: ids.A, userId: ids.alice, present: true } });
    await db.sessionGalleryMedia.create({ data: { sessionId: ids.s2, uploadedById: ids.alice, pathname: "sessions/s2/alice-photo.jpg", mimeType: "image/jpeg", sizeBytes: 1000 } });
    await db.sessionGalleryMedia.create({ data: { sessionId: ids.s2, uploadedById: ids.bob, pathname: "sessions/s2/bob-photo.jpg", mimeType: "image/jpeg", sizeBytes: 1000 } });
    await db.debt.create({ data: { debtorId: ids.alice, sessionId: ids.s1, reason: `Gage de ${ALICE.discordName}`, communityId: ids.A } });

    const tournament = await db.tournament.create({ data: { name: "Tournoi d'Alice", createdById: ids.alice, gameId: ids.g1, maxPlayers: 4, communityId: ids.A } });
    ids.t1 = tournament.id;
    await db.tournamentParticipant.createMany({ data: [{ tournamentId: tournament.id, userId: ids.alice }, { tournamentId: tournament.id, userId: ids.bob }] });
    await db.tournamentPrediction.create({ data: { communityId: ids.A, tournamentId: tournament.id, voterId: ids.alice, predictedUserId: ids.bob, target: "champion" } });
    await db.tournamentPrediction.create({ data: { communityId: ids.A, tournamentId: tournament.id, voterId: ids.bob, predictedUserId: ids.alice, target: "champion" } });

    const wish = await db.gameWishlist.create({ data: { gameId: ids.g1, proposedById: ids.alice, communityId: ids.A } });
    await db.gameWishlistVote.create({ data: { wishlistId: wish.id, userId: ids.bob, interested: true } });
    await db.communityDate.create({ data: { communityId: ids.A, createdById: ids.alice, memberId: ids.alice, kind: "BIRTHDAY", date: new Date("2000-05-17"), repeatsAnnually: true } });
    await db.communityDate.create({ data: { communityId: ids.A, createdById: ids.alice, kind: "IMPORTANT", title: "Anniversaire du serveur", date: new Date("2026-12-24") } });

    await db.towerChallengeDefinition.create({ data: { id: "def-a", communityId: ids.A, title: "Défi", instructions: "Fais-le", rewardFloors: 1, active: true } });
    const assignedAt = new Date();
    const attemptBase = { communityId: ids.A, definitionId: "def-a", title: "Défi", instructions: "Fais-le", rewardFloors: 1, assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * 3_600_000), submittedAt: assignedAt, proofChannelId: "123456789012345678", proofMessageId: "223456789012345678" };
    ids.soloAttempt = (await db.towerChallengeAttempt.create({ data: { ...attemptBase, userId: ids.alice, requestKey: "solo-key-0001", status: "SUBMITTED", proofText: `Preuve de ${ALICE.discordName}`, doubtReportedByUserId: ids.alice } })).id;
    await db.towerChallengeVote.create({ data: { communityId: ids.A, attemptId: ids.soloAttempt, userId: ids.bob, approve: true, createdAt: new Date() } });
    await db.towerChallengeAppeal.create({ data: { communityId: ids.A, attemptId: ids.soloAttempt, authorUserId: ids.alice, reason: "Je conteste", dueAt: new Date(Date.now() + 86_400_000) } });
    ids.sharedAttempt = (await db.towerChallengeAttempt.create({ data: { ...attemptBase, userId: ids.alice, requestKey: "shared-key-001", status: "SUBMITTED", proofText: "Preuve partagée de l'équipe", proofCode: "TWR-ABCD1234" } })).id;
    await db.towerChallengeAttemptParticipant.createMany({ data: [{ communityId: ids.A, attemptId: ids.sharedAttempt, userId: ids.alice }, { communityId: ids.A, attemptId: ids.sharedAttempt, userId: ids.bob }] });
    await db.towerChallengeAttempt.create({ data: { ...attemptBase, userId: ids.bob, requestKey: "bob-key-00001", status: "SUBMITTED", proofText: "Preuve de Bob" } });

    await db.boosterSupport.create({ data: { communityId: ids.A, userId: ids.alice, discordId: ALICE.discordId, checkedAt: new Date() } });
    await db.moderationReport.create({ data: { communityId: ids.A, guildId: "111111111111111111", channelId: "c1", messageId: "m1", authorDiscordId: ALICE.discordId, reporterDiscordId: BOB.discordId, messageUrl: "https://discord.com/channels/1/2/3", excerpt: `Message de ${ALICE.discordName}` } });
    await db.moderationReport.create({ data: { communityId: ids.A, guildId: "111111111111111111", channelId: "c1", messageId: "m2", authorDiscordId: BOB.discordId, reporterDiscordId: ALICE.discordId, messageUrl: "https://discord.com/channels/1/2/4", excerpt: "Message de Bob" } });
    await db.discordRoleRequest.create({ data: { communityId: ids.A, guildId: "111111111111111111", requesterDiscordId: ALICE.discordId, nameKey: "apex", name: "Apex" } });

    const event = await db.notificationEvent.create({
      data: { category: "SESSION", eventType: "SESSION_CREATED", sourceId: ids.alice, communityId: ids.A, payload: { creator: ALICE.discordName, mention: `<@${ALICE.discordId}>`, count: 3 } },
    });
    await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_DM", transport: "BOT", recipientKey: `user:${ids.alice}`, targetSlot: "slot-alice", discordChannelId: "dm-alice" } });
    await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_DM", transport: "BOT", recipientKey: `user:${ids.bob}`, targetSlot: "slot-bob" } });
    await db.monthlyRecap.create({ data: { communityId: ids.A, year: 2026, month: 10, data: { mvpOfMonth: { discordName: ALICE.discordName, count: 2 }, mostActive: { discordName: BOB.discordName, count: 4 } } } });
    await db.xpAdjustment.create({ data: { communityId: ids.A, userId: ids.alice, userName: ALICE.discordName, adminId: ids.bob, adminName: BOB.discordName, oldXp: 1, newXp: 2 } });
    await db.xpAdjustment.create({ data: { communityId: ids.A, userId: ids.bob, userName: BOB.discordName, adminId: ids.alice, adminName: ALICE.discordName, oldXp: 3, newXp: 4 } });
    await db.creationIntent.create({ data: { actorId: ids.alice, kind: "session", key: "k1", resourceId: ids.s1 } });
    await db.creationIntent.create({ data: { actorId: ids.bob, kind: "session", key: "k2", resourceId: ids.s2 } });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    blobOps = {
      listPublicUrls: vi.fn().mockResolvedValue([]),
      deletePublic: vi.fn().mockResolvedValue(undefined),
      deletePrivate: vi.fn().mockResolvedValue(undefined),
    };
    await seed();
    blobOps.listPublicUrls.mockResolvedValue([`https://abc123.public.blob.vercel-storage.com/banners/${ids.alice}/1699999999.png`]);
  }, 60_000);

  /** Occurrences d'un des motifs dans TOUTES les colonnes texte, JSON et tableaux de la base. */
  async function scan(needles: string[]): Promise<string[]> {
    const columns = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
         AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')`
    );
    expect(columns.length).toBeGreaterThan(300);
    const hits: string[] = [];
    const condition = needles.map((_, index) => `position($${index + 1} in "COL"::text) > 0`).join(" OR ");
    for (const { table_name: table, column_name: column } of columns) {
      const rows = await db.$queryRawUnsafe<Array<{ c: number }>>(
        `SELECT count(*)::int AS c FROM "${table}" WHERE ${condition.replaceAll("COL", column)}`,
        ...needles
      );
      if (rows[0].c > 0) hits.push(`${table}.${column} (${rows[0].c})`);
    }
    return hits;
  }

  const identifying = () => [
    ALICE.discordId, ALICE.discordName, ALICE.avatar, ALICE.accessToken, ALICE.refreshToken, ALICE.steamId64, ALICE.psnId,
    ALICE.pushEndpoint, ALICE.p256dh, ALICE.pushAuth, ALICE.email,
  ];

  /** Lignes d'un autre membre et d'une autre communauté : doivent rester identiques, octet pour octet. */
  async function snapshotOthers(): Promise<string> {
    const others = [ids.bob, ids.carol];
    const parts = await Promise.all([
      db.user.findMany({ where: { id: { in: others } }, orderBy: { id: "asc" } }),
      db.community.findUnique({ where: { id: ids.B } }),
      db.membership.findMany({ where: { OR: [{ userId: { in: others } }, { communityId: ids.B }] }, orderBy: { id: "asc" } }).then((rows) => rows.filter((row) => row.userId !== ids.alice)),
      db.communityMemberStats.findMany({ where: { OR: [{ userId: { in: others } }, { communityId: ids.B }] }, orderBy: [{ communityId: "asc" }, { userId: "asc" }] }),
      db.xpEvent.findMany({ where: { userId: { in: others } }, orderBy: { id: "asc" } }),
      db.session.findMany({ where: { createdById: { in: others } }, orderBy: { id: "asc" } }),
      db.proposal.findMany({ where: { proposedById: { in: others } }, orderBy: { id: "asc" } }),
      db.vote.findMany({ where: { userId: { in: others } }, orderBy: { id: "asc" } }),
      db.sessionInvite.findMany({ where: { OR: [{ userId: { in: others } }, { sessionId: ids.sb }] }, orderBy: { id: "asc" } }).then((rows) => rows.filter((row) => row.userId !== ids.alice)),
      db.chatMessage.findMany({ where: { userId: { in: others } }, orderBy: { id: "asc" } }),
      db.notification.findMany({ where: { userId: { in: others }, title: "Sans rapport" }, orderBy: { id: "asc" } }),
      db.sessionGalleryMedia.findMany({ where: { uploadedById: { in: others } }, orderBy: { id: "asc" } }),
      db.userGame.findMany({ where: { userId: { in: others } }, orderBy: { gameId: "asc" } }),
      db.creationIntent.findMany({ where: { actorId: { in: others } } }),
      db.towerChallengeAttempt.findMany({ where: { userId: ids.bob }, orderBy: { id: "asc" } }),
      db.tournamentParticipant.findMany({ where: { userId: { in: others } }, orderBy: { id: "asc" } }),
      db.tournamentPrediction.findMany({ where: { voterId: { in: others } }, orderBy: { id: "asc" } }),
      db.notificationDelivery.findMany({ where: { recipientKey: `user:${ids.bob}` } }),
    ]);
    return JSON.stringify(parts);
  }

  it("supprime les données personnelles : aucune ligne ne contient plus son identifiant, pseudo, avatar, jetons ou identifiants de plateforme", async () => {
    expect(await scan(identifying())).not.toEqual([]);
    const result = await api.deleteAccount(ids.alice, { blobOps });
    expect(result.status).toBe("deleted");
    expect(await scan(identifying())).toEqual([]);
  }, 120_000);

  it("anonymise la ligne User sans la supprimer et invalide la session", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: ids.alice } });
    expect(before.forceReloginAt).toBeNull();
    await api.deleteAccount(ids.alice, { blobOps, now: new Date("2026-11-21T10:00:00Z") });
    const after = await db.user.findUniqueOrThrow({ where: { id: ids.alice } });
    expect(after).toMatchObject({
      discordId: `deleted:${ids.alice}`, discordName: "Ancien membre", discordAvatar: null, discordAccessToken: null, discordRefreshToken: null,
      discordTokenExpiresAt: null, bannerUrl: null, steamId64: null, psnId: null, steamPublic: false, role: "USER", xpTotal: 0, streakCount: 0,
      inputDevices: [], availablePlatforms: [], preferredGameCategories: [], colorCustomized: false,
    });
    expect(after.forceReloginAt).toEqual(new Date("2026-11-21T10:00:00Z"));
    // `getCurrentUser` retrouve la session par `discordId` : l'ancien identifiant ne désigne plus personne.
    expect(await db.user.findUnique({ where: { discordId: ALICE.discordId } })).toBeNull();
    expect(await db.membership.count({ where: { userId: ids.alice } })).toBe(0);
    const log = await db.accountDeletionLog.findMany();
    expect(log).toHaveLength(1);
    expect(log[0].userId).toBe(ids.alice);
  });

  it("supprime ses fichiers Blob : bannière publique (anciennes versions comprises) et médias de galerie, jamais ceux d'un autre", async () => {
    await api.deleteAccount(ids.alice, { blobOps });
    expect(blobOps.listPublicUrls).toHaveBeenCalledWith(`banners/${ids.alice}`);
    const publicUrls = blobOps.deletePublic.mock.calls[0][0] as string[];
    expect(publicUrls.sort()).toEqual([
      `https://abc123.public.blob.vercel-storage.com/banners/${ids.alice}/1699999999.png`,
      `https://abc123.public.blob.vercel-storage.com/banners/${ids.alice}/1700000000.png`,
    ]);
    expect(blobOps.deletePrivate).toHaveBeenCalledWith(["sessions/s2/alice-photo.jpg"]);
  });

  it("une bannière externe (hors Vercel Blob) n'appelle jamais le store", async () => {
    await db.user.update({ where: { id: ids.alice }, data: { bannerUrl: "https://static.klipy.com/banner.gif" } });
    await api.deleteAccount(ids.alice, { blobOps });
    expect(blobOps.listPublicUrls).not.toHaveBeenCalled();
    expect(blobOps.deletePublic).toHaveBeenCalledWith([]);
  });

  it("un échec de suppression de fichier refuse la suppression sans rien changer en base", async () => {
    blobOps.deletePrivate.mockRejectedValue(new Error("blob indisponible"));
    await expect(api.deleteAccount(ids.alice, { blobOps })).rejects.toThrow("blob indisponible");
    const user = await db.user.findUniqueOrThrow({ where: { id: ids.alice } });
    expect(user.discordId).toBe(ALICE.discordId);
    expect(await db.userGame.count({ where: { userId: ids.alice } })).toBe(1);
    expect(await db.accountDeletionLog.count()).toBe(0);
  });

  it("conserve les contenus collectifs sans lien identifiant et efface le pseudo de leurs textes", async () => {
    await api.deleteAccount(ids.alice, { blobOps });
    expect(await db.session.findUnique({ where: { id: ids.s1 } })).toMatchObject({ createdById: ids.alice });
    expect(await db.tournament.findUnique({ where: { id: ids.t1 } })).toMatchObject({ createdById: ids.alice });
    expect(await db.tournamentParticipant.count({ where: { tournamentId: ids.t1 } })).toBe(2);
    expect(await db.sessionResult.count({ where: { sessionId: ids.s1 } })).toBe(2);
    expect(await db.game.findUnique({ where: { id: ids.g2 } })).toMatchObject({ addedById: ids.alice });
    expect(await db.gameWishlist.count({ where: { proposedById: ids.alice } })).toBe(1);
    expect(await db.debt.findFirstOrThrow({ where: { debtorId: ids.alice } })).toMatchObject({ reason: "Gage de Ancien membre" });
    expect(await db.sessionInvite.count({ where: { sessionId: ids.s1, userId: ids.bob } })).toBe(1);
    // Notification d'un AUTRE membre qui citait son pseudo : le pseudo disparaît, le reste est conservé.
    expect((await db.notification.findFirstOrThrow({ where: { userId: ids.bob, title: "Mention" } })).message).toBe("Ancien membre n'a jamais gagné au Jeu commun");
    expect((await db.notificationEvent.findFirstOrThrow()).payload).toEqual({ creator: "Ancien membre", mention: "<@Ancien membre>", count: 3 });
    expect((await db.monthlyRecap.findFirstOrThrow()).data).toEqual({ mvpOfMonth: { discordName: "Ancien membre", count: 2 }, mostActive: { discordName: BOB.discordName, count: 4 } });
    expect(await db.moderationReport.findMany({ orderBy: { messageId: "asc" } })).toMatchObject([
      { authorDiscordId: `deleted:${ids.alice}`, reporterDiscordId: BOB.discordId, excerpt: "[supprimé]" },
      { authorDiscordId: BOB.discordId, reporterDiscordId: `deleted:${ids.alice}`, excerpt: "Message de Bob" },
    ]);
    expect(await db.discordRoleRequest.findFirstOrThrow()).toMatchObject({ requesterDiscordId: `deleted:${ids.alice}` });
    expect((await db.community.findUniqueOrThrow({ where: { id: ids.A } })).installedByDiscordId).toBeNull();
    expect(await db.xpAdjustment.findMany({ orderBy: { oldXp: "asc" } })).toMatchObject([
      { userName: "Ancien membre", adminName: BOB.discordName },
      { userName: BOB.discordName, adminName: "Ancien membre" },
    ]);
  });

  it("les défis Tower solo sont supprimés avec leurs preuves, votes et recours ; un défi partagé garde ses participants sans la preuve", async () => {
    await api.deleteAccount(ids.alice, { blobOps });
    expect(await db.towerChallengeAttempt.findUnique({ where: { id: ids.soloAttempt } })).toBeNull();
    expect(await db.towerChallengeVote.count({ where: { attemptId: ids.soloAttempt } })).toBe(0);
    expect(await db.towerChallengeAppeal.count()).toBe(0);
    const shared = await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: ids.sharedAttempt }, include: { participants: true } });
    expect(shared).toMatchObject({ proofText: "[supprimé]", proofCode: null });
    expect(shared.participants.map((p) => p.userId)).toEqual([ids.bob]);
  });

  it("chaque relation classée DELETE est vide pour la personne après suppression", async () => {
    await api.deleteAccount(ids.alice, { blobOps });
    for (const { model, field } of [...plan.planEntries("DELETE"), ...plan.nonFkEntries("DELETE")]) {
      const delegate = (db as unknown as Record<string, { count(args: { where: Record<string, unknown> }): Promise<number> }>)[plan.modelAccessor(model)];
      expect(await delegate.count({ where: { [field]: ids.alice } }), `${model}.${field}`).toBe(0);
    }
    expect(await db.notificationDelivery.count({ where: { recipientKey: `user:${ids.alice}` } })).toBe(0);
  });

  it("n'affecte aucun autre utilisateur ni aucune autre communauté", async () => {
    const before = await snapshotOthers();
    expect(before.length).toBeGreaterThan(2000);
    await api.deleteAccount(ids.alice, { blobOps });
    expect(await snapshotOthers()).toBe(before);
    expect(await db.towerChallengeAttempt.count({ where: { userId: ids.bob } })).toBe(1);
  });

  it("refuse tant que la personne est le dernier OWNER d'une communauté, sans rien changer ; accepte quand un autre OWNER existe", async () => {
    const result = await api.deleteAccount(ids.bob, { blobOps });
    expect(result).toEqual({ status: "refused", reason: "last_owner", communities: ["Communauté A"] });
    expect(blobOps.deletePrivate).not.toHaveBeenCalled();
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.bob } })).discordId).toBe(BOB.discordId);
    expect(await db.membership.count({ where: { userId: ids.bob } })).toBe(1);

    await db.membership.update({ where: { communityId_userId: { communityId: ids.A, userId: ids.alice } }, data: { role: "OWNER" } });
    expect((await api.deleteAccount(ids.bob, { blobOps })).status).toBe("deleted");
  });

  it("un OWNER qui n'est plus actif ne compte pas comme successeur", async () => {
    await db.membership.update({ where: { communityId_userId: { communityId: ids.A, userId: ids.alice } }, data: { role: "OWNER", status: "LEFT" } });
    expect((await api.deleteAccount(ids.bob, { blobOps })).status).toBe("refused");
  });

  it("un compte sans aucune donnée s'efface aussi (chaque règle du classement s'exécute sans erreur sur la vraie base)", async () => {
    const empty = await db.user.create({ data: { discordId: "612345678901234567", discordName: "VideUnique" } });
    const result = await api.deleteAccount(empty.id, { blobOps });
    expect(result).toEqual({ status: "deleted", summary: {} });
    expect(await scan(["VideUnique", "612345678901234567"])).toEqual([]);
  }, 60_000);

  it("est idempotente et ignore un compte inconnu", async () => {
    expect((await api.deleteAccount(ids.alice, { blobOps })).status).toBe("deleted");
    expect(await api.deleteAccount(ids.alice, { blobOps })).toEqual({ status: "already_deleted" });
    expect(await api.deleteAccount("inconnu", { blobOps })).toEqual({ status: "not_found" });
    expect(await db.accountDeletionLog.count()).toBe(1);
  });

  it("la personne se reconnecte ensuite avec un NOUVEAU compte, sans conflit d'unicité (identifiant Discord, Steam)", async () => {
    await api.deleteAccount(ids.alice, { blobOps });
    // Même séquence que le callback `signIn` de src/auth.ts : upsert par identifiant Discord, puis appartenances.
    const reconnected = await db.$transaction(async (tx) => {
      const { id } = await tx.user.upsert({
        where: { discordId: ALICE.discordId },
        update: { discordName: ALICE.discordName },
        create: { discordId: ALICE.discordId, discordName: ALICE.discordName, discordAvatar: ALICE.avatar, steamId64: ALICE.steamId64 },
        select: { id: true },
      });
      const active = await oauth.syncOAuthMemberships(tx, id, ["111111111111111111"], new Date());
      return { id, active };
    });
    expect(reconnected.id).not.toBe(ids.alice);
    expect(reconnected.active).toEqual([ids.A]);
    expect(await db.membership.count({ where: { userId: reconnected.id, status: "ACTIVE" } })).toBe(1);
    // L'ancien compte reste anonymisé, sans rien hériter du nouveau.
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.alice } })).discordName).toBe("Ancien membre");
    expect(await db.userGame.count({ where: { userId: reconnected.id } })).toBe(0);
    expect(await db.communityMemberStats.count({ where: { userId: reconnected.id } })).toBe(0);
  });

  describe("export des données personnelles", () => {
    it("contient les données de la personne et rien d'autre : ni jetons, ni clés, ni identifiants ou contenus d'autrui", async () => {
      const data = await exportApi.buildAccountExport(ids.alice, new Date("2026-11-21T10:00:00Z"));
      expect(data).not.toBeNull();
      const text = exportApi.serializeAccountExport(data!);
      expect(data!.format).toBe("gamenight-export-v1");
      expect(data!.compte).toMatchObject({ discordId: ALICE.discordId, discordName: ALICE.discordName, psnId: ALICE.psnId, steamId64: ALICE.steamId64 });
      expect(Object.keys(data!.donnees)).toEqual(expect.arrayContaining(["UserGame", "ChatMessage", "Session", "Debt", "Membership", "Notification", "TowerChallengeAttempt", "XpEvent", "SessionResult"]));
      expect(text).toContain("Salut c'est Alice");

      // Secrets de la personne.
      for (const secret of [ALICE.accessToken, ALICE.refreshToken, ALICE.pushEndpoint, ALICE.p256dh, ALICE.pushAuth, "a".repeat(64), "alice-photo.jpg"]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(data!.donnees.WebPushSubscription).toHaveLength(1);
      expect(Object.keys(data!.donnees.WebPushSubscription[0]).sort()).toEqual(["createdAt", "id", "updatedAt"]);
      expect(Object.keys(data!.donnees.CalendarFeedToken[0]).sort()).toEqual(["communityId", "createdAt", "id", "revokedAt"]);

      // Autrui : identifiants, pseudos et contenus.
      for (const other of [ids.bob, ids.carol, BOB.discordId, CAROL.discordId, "Salut c'est Bob", "Preuve de Bob", "bob_psn", "bob-photo"]) {
        expect(text, other).not.toContain(other);
      }
      // Les lignes d'autres membres (soirée de Bob, tournois des autres) ne figurent pas, hors celles de la personne.
      expect(data!.donnees.Session.map((row) => row.createdById)).toEqual([ids.alice]);
      expect(data!.donnees.SessionInvite.every((row) => row.userId === ids.alice)).toBe(true);
      expect(data!.donnees.ChatMessage).toHaveLength(1);
    });

    it("ne retourne rien pour un compte inconnu et reste lisible (JSON valide) après anonymisation", async () => {
      expect(await exportApi.buildAccountExport("inconnu")).toBeNull();
      await api.deleteAccount(ids.alice, { blobOps });
      const data = await exportApi.buildAccountExport(ids.alice);
      expect(() => JSON.parse(exportApi.serializeAccountExport(data!))).not.toThrow();
      expect(data!.compte.discordName).toBe("Ancien membre");
      expect(Object.keys(data!.donnees)).not.toContain("UserGame");
    });
  });
});
