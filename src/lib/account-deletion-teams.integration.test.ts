import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AccountBlobOps } from "@/lib/account-deletion";

/**
 * D5 : supprimer son compte est un départ. Le DERNIER membre actif d'une équipe qui supprime son compte applique les mêmes blocages que la
 * dissolution (défi en cours, signalement ou contestation ouverts : suppression REFUSÉE, rien d'effacé) ; sinon l'équipe est vidée et la
 * suppression des salons est enfilée (identifiants enregistrés, accès des anciens membres). PostgreSQL local jetable ; Discord jamais appelé ;
 * Blob mocké. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@vercel/blob", () => ({ del: vi.fn(), list: vi.fn(), head: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new Client({ datasourceUrl: TEST_DATABASE_URL }) };
});
if (!TEST_DATABASE_URL) console.warn("[account-deletion-teams] TEST_DATABASE_URL absente : suite SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("suppression de compte : dernier membre d'une équipe (D5)", () => {
  let db: PrismaClient;
  let api: typeof import("@/lib/account-deletion");
  const ids = {} as Record<string, string>;
  const GUILD = "333333333333333333";
  const blobOps: AccountBlobOps = {
    listPublicUrls: vi.fn(async () => []), deletePublic: vi.fn(async () => undefined), deletePrivate: vi.fn(async () => undefined),
  } as unknown as AccountBlobOps;
  const TABLES = 'TRUNCATE "User", "Community", "Game", "AccountDeletionLog", "NotificationEvent", "TowerChallengeAttempt", "TowerChallengeDefinition" CASCADE';

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    api = await import("@/lib/account-deletion");
  });
  afterAll(async () => { await db?.$executeRawUnsafe(TABLES); await db?.$disconnect(); vi.unstubAllEnvs(); });

  beforeEach(async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
    await db.$executeRawUnsafe(TABLES);
    ids.community = (await db.community.create({ data: { slug: "dteams", name: "Équipes", status: "ACTIVE", discordGuildId: GUILD, communityTeamsEnabled: true } })).id;
    for (const [name, discordId] of [["solo", "811111111111111111"], ["other", "822222222222222222"], ["mate", "833333333333333333"]] as const) {
      ids[name] = (await db.user.create({ data: { discordId, discordName: name } })).id;
      await db.membership.create({ data: { userId: ids[name], communityId: ids.community, status: "ACTIVE" } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.solo } })).id;
  });

  const newTeam = async (name: string, members: string[]) => {
    const team = await db.communityTeam.create({ data: { communityId: ids.community, gameId: ids.game, createdById: ids[members[0]], captainId: ids[members[0]],
      name, description: "Équipe de test D5.", platform: "PC", maxMembers: 4 } });
    for (const m of members) await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: team.id, userId: ids[m] } });
    await db.discordTeamSpace.create({ data: { teamId: team.id, communityId: ids.community, guildId: GUILD, channelId: `${name}-chan`, voiceChannelId: `${name}-voice` } });
    return team;
  };
  const userIntact = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).discordName !== "Ancien membre";

  it("un signalement ouvert sur un salon de l'équipe REFUSE la suppression du compte : rien n'est effacé ni enfilé", async () => {
    const team = await newTeam("Solitaire", ["solo"]);
    await db.moderationReport.create({ data: { communityId: ids.community, guildId: GUILD, channelId: "Solitaire-chan", messageId: "m1", authorDiscordId: "a", reporterDiscordId: "r",
      messageUrl: `https://discord.com/channels/${GUILD}/Solitaire-chan/m1`, excerpt: "message signalé" } });
    expect(await api.deleteAccount(ids.solo, { blobOps })).toEqual({ status: "refused", reason: "team_blocked", teams: ["Solitaire"] });
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
    expect(await userIntact(ids.solo)).toBe(true);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("un défi en cours ou une contestation ouverte refuse aussi la suppression", async () => {
    const team = await newTeam("Defi", ["solo"]);
    const definition = await db.towerChallengeDefinition.create({ data: { communityId: ids.community, title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1 } });
    const attempt = await db.towerChallengeAttempt.create({ data: { communityId: ids.community, userId: ids.solo, teamId: team.id, definitionId: definition.id, requestKey: "k1",
      title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1, assignedAt: new Date("2030-01-01T00:00:00Z"), expiresAt: new Date("2030-01-03T00:00:00Z") } });
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("refused");
    await db.towerChallengeAttempt.update({ where: { id: attempt.id }, data: { status: "REJECTED", rejectedAt: new Date("2030-01-03T01:00:00Z") } });
    const appeal = await db.towerChallengeAppeal.create({ data: { communityId: ids.community, attemptId: attempt.id, authorUserId: ids.solo, reason: "Contestation du verdict.", dueAt: new Date("2030-01-08") } });
    expect(await api.deleteAccount(ids.solo, { blobOps })).toMatchObject({ status: "refused", reason: "team_blocked" });
    expect(await userIntact(ids.solo)).toBe(true);
    await db.towerChallengeAppeal.update({ where: { id: appeal.id }, data: { status: "UPHELD", decidedAt: new Date() } });
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
  });

  it("sans blocage : l'équipe est vidée (toutes les lignes) et la suppression des salons est enfilée avec les accès à retirer", async () => {
    const team = await newTeam("Libre", ["solo"]);
    // Ligne d'un ancien membre devenu inactif : elle doit disparaître aussi, sinon l'exécution jugerait l'équipe « repeuplée ».
    await db.user.update({ where: { id: ids.other }, data: {} });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.other } }, data: { status: "LEFT" } });
    await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: team.id, userId: ids.other } });
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).isRecruiting).toBe(false);
    const event = await db.notificationEvent.findFirstOrThrow({ where: { eventType: "TEAM_SPACE_SYNC", sourceId: team.id } });
    expect(event.payload).toMatchObject({ intent: "delete", actorUserId: ids.solo });
    expect((event.payload as { formerMemberDiscordIds: string[] }).formerMemberDiscordIds.sort()).toEqual(["811111111111111111", "822222222222222222"]);
    // Les identifiants des salons sont lus dans DiscordTeamSpace à l'exécution : jamais dans l'événement.
    expect(JSON.stringify(event.payload)).not.toContain("Libre-chan");
  });

  it("une équipe qui garde un autre membre ACTIF n'est ni vidée ni supprimée", async () => {
    const team = await newTeam("Duo", ["solo", "mate"]);
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
    expect(await db.notificationEvent.count({ where: { eventType: "TEAM_SPACE_SYNC" } })).toBe(0);
  });
});
