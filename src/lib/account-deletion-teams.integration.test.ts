import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AccountBlobOps } from "@/lib/account-deletion";

/**
 * D5 : supprimer son compte est un départ. Le DERNIER membre actif d'une équipe qui supprime son compte dissout l'équipe (les deux salons
 * sont supprimés par la file) ; un défi en cours, un signalement ou une contestation ouverts NE REFUSENT PAS la suppression (droit à
 * l'effacement) : l'équipe reste non dissoute, salons intacts, jusqu'à la fin du blocage. Un nouvel arrivant n'est jamais éjecté. PostgreSQL
 * local jetable ; Discord jamais appelé ; Blob mocké. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
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
  let teamsModule: typeof import("@/lib/account-deletion-teams");
  let sweep: typeof import("@/lib/discord-team-space-sweep");
  const ids = {} as Record<string, string>;
  const GUILD = "333333333333333333";
  const blobOps: AccountBlobOps = {
    listPublicUrls: vi.fn(async () => []), deletePublic: vi.fn(async () => undefined), deletePrivate: vi.fn(async () => undefined),
  } as unknown as AccountBlobOps;
  const TABLES = 'TRUNCATE "User", "Community", "Game", "AccountDeletionLog", "NotificationEvent", "SensitiveOperationLog", "TowerChallengeAttempt", "TowerChallengeDefinition" CASCADE';

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    api = await import("@/lib/account-deletion");
    teamsModule = await import("@/lib/account-deletion-teams");
    sweep = await import("@/lib/discord-team-space-sweep");
  });
  afterAll(async () => { await db?.$executeRawUnsafe(TABLES); await db?.$disconnect(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
    await db.$executeRawUnsafe(TABLES);
    ids.community = (await db.community.create({ data: { slug: "dteams", name: "Équipes", status: "ACTIVE", discordGuildId: GUILD, communityTeamsEnabled: true } })).id;
    for (const [name, discordId] of [["solo", "811111111111111111"], ["other", "822222222222222222"], ["mate", "833333333333333333"], ["late", "844444444444444444"]] as const) {
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
  const anonymized = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).discordName === "Ancien membre";
  const deleteEvents = (teamId: string) => db.notificationEvent.count({ where: { eventType: "TEAM_SPACE_SYNC", sourceId: teamId } });
  const openReport = (channelId: string) => db.moderationReport.create({ data: { communityId: ids.community, guildId: GUILD, channelId, messageId: "m1", authorDiscordId: "a", reporterDiscordId: "r",
    messageUrl: `https://discord.com/channels/${GUILD}/${channelId}/m1`, excerpt: "message signalé" } });

  it("I2 : un signalement ouvert NE REFUSE PAS la suppression du compte : l'équipe reste non dissoute (salons intacts), puis le balayage la dissout quand le blocage tombe", async () => {
    const team = await newTeam("Solitaire", ["solo"]);
    const report = await openReport("Solitaire-chan");
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(await anonymized(ids.solo)).toBe(true);
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).isRecruiting).toBe(false);
    expect((await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: team.id } })).deletedAt).toBeNull();
    expect(await deleteEvents(team.id)).toBe(0);
    // Tant que le signalement est ouvert : le balayage n'enfile rien.
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 0, queued: 0 });
    expect(await deleteEvents(team.id)).toBe(0);
    await db.moderationReport.update({ where: { id: report.id }, data: { closedAt: new Date() } });
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 1, queued: 1 });
    expect(await deleteEvents(team.id)).toBe(1);
  });

  it("I2 : un défi en cours puis une contestation ouverte ne refusent pas non plus la suppression ; ils retardent seulement la dissolution", async () => {
    const team = await newTeam("Defi", ["solo"]);
    const definition = await db.towerChallengeDefinition.create({ data: { communityId: ids.community, title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1 } });
    const attempt = await db.towerChallengeAttempt.create({ data: { communityId: ids.community, userId: ids.other, teamId: team.id, definitionId: definition.id, requestKey: "k1",
      title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1, assignedAt: new Date("2030-01-01T00:00:00Z"), expiresAt: new Date("2030-01-03T00:00:00Z") } });
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(await deleteEvents(team.id)).toBe(0);
    expect((await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: team.id } })).deletedAt).toBeNull();
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 0, queued: 0 });
    // Défi terminé mais contestation ouverte : toujours bloqué.
    await db.towerChallengeAttempt.update({ where: { id: attempt.id }, data: { status: "REJECTED", rejectedAt: new Date("2030-01-03T01:00:00Z") } });
    const appeal = await db.towerChallengeAppeal.create({ data: { communityId: ids.community, attemptId: attempt.id, authorUserId: ids.other, reason: "Contestation du verdict.", dueAt: new Date("2030-01-08") } });
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 0, queued: 0 });
    await db.towerChallengeAppeal.update({ where: { id: appeal.id }, data: { status: "UPHELD", decidedAt: new Date() } });
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ queued: 1, blocked: 0 });
  });

  it("sans blocage : équipe vidée (toutes les lignes), dissolution INSCRITE au journal, suppression des salons enfilée avec les accès à retirer", async () => {
    const team = await newTeam("Libre", ["solo"]);
    // Ligne d'un ancien membre devenu inactif : elle doit disparaître aussi, sinon l'exécution jugerait l'équipe « repeuplée ».
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
    expect(await db.sensitiveOperationLog.count({ where: { action: "team.dissolve", outcome: "account_deleted", target: team.id } })).toBe(1);
  });

  it("une équipe qui garde un autre membre ACTIF n'est ni vidée ni supprimée", async () => {
    const team = await newTeam("Duo", ["solo", "mate"]);
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
    expect(await deleteEvents(team.id)).toBe(0);
    expect(await db.sensitiveOperationLog.count({ where: { action: "team.dissolve" } })).toBe(0);
  });

  it("B1 : un nouvel arrivant entre la lecture des équipes et la transaction n'est JAMAIS éjecté (recomptage sous verrou) : équipe conservée, aucune suppression enfilée", async () => {
    const team = await newTeam("Course", ["solo"]);
    const original = teamsModule.listLastMemberTeams;
    // L'arrivée a lieu APRÈS la lecture préalable (qui voit « solo » comme dernier membre) et AVANT la transaction de suppression.
    const spy = vi.spyOn(teamsModule, "listLastMemberTeams").mockImplementation(async (userId: string) => {
      const read = await original(userId);
      await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: team.id, userId: ids.late } });
      return read;
    });
    expect((await api.deleteAccount(ids.solo, { blobOps })).status).toBe("deleted");
    expect(spy).toHaveBeenCalled();
    expect(await db.communityTeamMember.findMany({ where: { teamId: team.id }, select: { userId: true } })).toEqual([{ userId: ids.late }]);
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).isRecruiting).toBe(true);
    expect(await deleteEvents(team.id)).toBe(0);
    expect(await db.sensitiveOperationLog.count({ where: { action: "team.dissolve" } })).toBe(0);
  });

  it("B1 : une arrivée EN COURS de validation (ligne insérée, transaction non terminée) bloque sur le verrou de l'équipe, puis est vue au recomptage : jamais éjectée", async () => {
    const team = await newTeam("Verrou", ["solo"]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let inserted: () => void = () => undefined;
    const insertedSignal = new Promise<void>((resolve) => { inserted = resolve; });
    const arrival = db.$transaction(async (tx) => {
      await tx.communityTeamMember.create({ data: { communityId: ids.community, teamId: team.id, userId: ids.late } });
      inserted();
      await gate;
    });
    await insertedSignal;
    const deletion = api.deleteAccount(ids.solo, { blobOps });
    // La suppression attend la clé étrangère de l'arrivant (FOR UPDATE de l'équipe) ; on laisse l'arrivée se valider.
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await arrival;
    expect((await deletion).status).toBe("deleted");
    expect(await db.communityTeamMember.findMany({ where: { teamId: team.id }, select: { userId: true } })).toEqual([{ userId: ids.late }]);
    expect(await deleteEvents(team.id)).toBe(0);
  });
});
