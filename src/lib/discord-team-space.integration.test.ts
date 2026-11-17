import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable, jamais Neon/Production.
 * Ignorée sans `TEST_DATABASE_URL` (voir docs/migrations/pending/…).
 *
 * Prérequis sur la base :
 *   prisma migrate deploy
 *
 * `CommunityTeam.captainId` appartient à la migration de la PR #370, pas à cette
 * branche : sans elle, le test vérifie le repli documenté
 * (`captain_source_unavailable`, `createdById` intact) au lieu du transfert.
 * Les deux états sont donc recettés, jamais sautés.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — espaces et capitaine", () => {
  let db: PrismaClient;
  let service: typeof import("./community-team-captain-service");
  let spaceStore: typeof import("./discord-team-space-service");
  const ids: Record<string, string> = {};
  const GUILD = "100000000000000001";
  const CREATOR_DISCORD = "100000000000000021";
  const MEMBER_DISCORD = "100000000000000022";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    service = await import("./community-team-captain-service");
    spaceStore = await import("./discord-team-space-service");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /**
   * `captainId` n'est pas déclaré dans le schéma de cette branche (il arrive avec
   * #370) : on sonde la colonne par nom, sans type Prisma ni DDL.
   */
  async function hasCaptainColumn(): Promise<boolean> {
    const bridge = db.communityTeam as unknown as {
      findFirst(args: { select: { captainId: true } }): Promise<unknown>;
    };
    try {
      await bridge.findFirst({ select: { captainId: true } });
      return true;
    } catch (error) {
      // Colonne absente : Prisma répond P2022 en base non migrée, et refuse le
      // champ inconnu (validation) tant que le schéma de la branche ne le
      // déclare pas. Même heuristique que `community-team-captain-store.ts`.
      const message = (error as Error)?.message ?? "";
      if ((error as { code?: string }).code === "P2022" || message.includes("captainId")) return false;
      throw error;
    }
  }

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "DiscordTeamSpace", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`
    );
    ids.community = (
      await db.community.create({
        data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true, discordGuildId: GUILD },
      })
    ).id;
    ids.creator = (await db.user.create({ data: { discordId: CREATOR_DISCORD, discordName: "Maxime" } })).id;
    ids.member = (await db.user.create({ data: { discordId: MEMBER_DISCORD, discordName: "Sarah" } })).id;
    for (const userId of [ids.creator, ids.member]) {
      await db.membership.create({ data: { userId, communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.creator } })).id;
    ids.team = (
      await db.communityTeam.create({
        data: {
          communityId: ids.community,
          gameId: ids.game,
          createdById: ids.creator,
          name: "Les Dragons",
          description: "Explorer et construire ensemble.",
          platform: "PC",
          maxMembers: 8,
        },
      })
    ).id;
    for (const userId of [ids.creator, ids.member]) {
      await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: ids.team, userId } });
    }
  });

  it("impose l'unicité de l'équipe et du salon associés", async () => {
    const store = spaceStore.createPrismaSpaceLinkStore(db);
    await store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    expect(await db.discordTeamSpace.count()).toBe(1);

    await expect(
      db.discordTeamSpace.create({
        data: { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-2", roleId: "role-2" },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    const otherTeam = await db.communityTeam.create({
      data: {
        communityId: ids.community,
        gameId: ids.game,
        createdById: ids.creator,
        name: "Autre",
        description: "Une autre équipe de test.",
        platform: "PC",
        maxMembers: 4,
      },
    });
    await expect(
      db.discordTeamSpace.create({
        data: { teamId: otherTeam.id, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-9" },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("reste idempotent sur un rejeu et sous créations concurrentes", async () => {
    const store = spaceStore.createPrismaSpaceLinkStore(db);
    await store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    await store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    expect(await db.discordTeamSpace.count()).toBe(1);

    const results = await Promise.allSettled([
      store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-2", roleId: "role-2" }),
      store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-2", roleId: "role-2" }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const rows = await db.discordTeamSpace.findMany({ where: { teamId: ids.team } });
    expect(rows).toHaveLength(1);
    expect(rows[0].channelId).toBe("chan-1");
  });

  it("conserve l'association après un nouveau client (redémarrage du service)", async () => {
    await spaceStore
      .createPrismaSpaceLinkStore(db)
      .save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });

    const restarted = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    try {
      const link = await spaceStore.createPrismaSpaceLinkStore(restarted).find(ids.team);
      expect(link).toMatchObject({ channelId: "chan-1", roleId: "role-1", archived: false });
      const read = await spaceStore.readTeamSpaceLink({ teamId: ids.team, store: spaceStore.createPrismaSpaceLinkStore(restarted) });
      expect(read).toMatchObject({ status: "linked", channelId: "chan-1" });
    } finally {
      await restarted.$disconnect();
    }
  });

  it("parcours A/B/C : création, adhésion et départ avec le vrai store SQL", async () => {
    const teams = await import("./community-teams");
    const created = await teams.createCommunityTeamWithId({
      userId: ids.creator,
      communityId: ids.community,
      gameId: ids.game,
      name: "Expédition",
      description: "Construire et explorer ensemble.",
      platform: "PC",
      maxMembers: 4,
    });
    expect(created.status).toBe("created");
    const teamId = created.teamId!;

    const created0 = { channels: 0, roles: 0, added: [] as string[], removed: [] as string[] };
    const api = {
      snapshot: async () => ({ channels: [], roles: [] }),
      createRole: async () => {
        created0.roles += 1;
        return "role-flow";
      },
      createChannel: async () => {
        created0.channels += 1;
        return "chan-flow";
      },
      renameChannel: async () => undefined,
      addMemberRole: async (_g: string, userId: string) => {
        created0.added.push(userId);
      },
      removeMemberRole: async (_g: string, userId: string) => {
        created0.removed.push(userId);
      },
    };
    const store = spaceStore.createPrismaSpaceLinkStore(db);
    const enabled = { DISCORD_TEAM_SPACES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

    expect((await spaceStore.provisionTeamSpace({ teamId, communityId: ids.community, api, store, env: enabled })).status).toBe("created");
    expect((await spaceStore.provisionTeamSpace({ teamId, communityId: ids.community, api, store, env: enabled })).status).toBe("reused");
    expect({ roles: created0.roles, channels: created0.channels }).toEqual({ roles: 1, channels: 1 });
    expect(await store.find(teamId)).toMatchObject({ channelId: "chan-flow", roleId: "role-flow" });

    // B — adhésion du second joueur, accès de cette seule équipe.
    expect(await teams.joinCommunityTeam(ids.member, ids.community, teamId)).toBe("joined");
    expect(
      await spaceStore.syncTeamSpaceMember({
        teamId,
        communityId: ids.community,
        discordId: MEMBER_DISCORD,
        action: "join",
        api,
        store,
        env: enabled,
      })
    ).toEqual({ status: "updated" });
    expect(created0.added).toContain(MEMBER_DISCORD);

    // C — départ : rôle retiré, aucune progression écrite.
    const xpBefore = await db.xpEvent.count();
    expect(await teams.leaveCommunityTeam(ids.member, ids.community, teamId)).toBe("left");
    expect(
      await spaceStore.syncTeamSpaceMember({
        teamId,
        communityId: ids.community,
        discordId: MEMBER_DISCORD,
        action: "leave",
        api,
        store,
        env: enabled,
      })
    ).toEqual({ status: "removed" });
    expect(created0.removed).toContain(MEMBER_DISCORD);
    expect(await db.xpEvent.count()).toBe(xpBefore);
  });

  it("parcours E : archive uniquement le salon associé, sans autre ressource", async () => {
    const teamId = (
      await db.communityTeam.create({
        data: {
          communityId: ids.community,
          gameId: ids.game,
          createdById: ids.creator,
          name: "Inactive",
          description: "Équipe sans membre actif.",
          platform: "PC",
          maxMembers: 3,
        },
      })
    ).id;
    await db.communityTeamMember.deleteMany({ where: { teamId } });
    await spaceStore
      .createPrismaSpaceLinkStore(db)
      .save({ teamId, communityId: ids.community, guildId: GUILD, channelId: "chan-owned", roleId: "role-owned" });

    const renamed: string[] = [];
    const api = {
      snapshot: async () => ({
        channels: [
          { id: "chan-owned", name: "inactive", type: 0 },
          { id: "chan-historical", name: "general", type: 0 },
        ],
        roles: [{ id: "role-owned", name: "GN · Inactive" }],
      }),
      createRole: async () => "interdit",
      createChannel: async () => "interdit",
      renameChannel: async (channelId: string) => {
        renamed.push(channelId);
      },
      addMemberRole: async () => undefined,
      removeMemberRole: async () => undefined,
    };
    const enabled = { DISCORD_TEAM_SPACES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;
    const result = await spaceStore.archiveInactiveTeamSpace({
      teamId,
      communityId: ids.community,
      api,
      store: spaceStore.createPrismaSpaceLinkStore(db),
      env: enabled,
    });
    expect(result.status).toBe("reused");
    expect(renamed).toEqual(["chan-owned"]);
    const link = await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId } });
    expect(link.archived).toBe(true);
  });

  it("transfère captainId sans toucher createdById, et bloque la course suivante", async () => {
    // Sans la colonne (#370 non fusionnée), la passation est refusée et rien
    // n'est modifié : c'est le contrat produit, pas un test ignoré.
    if (!(await hasCaptainColumn())) {
      expect(
        await service.transferTeamCaptain({ teamId: ids.team, communityId: ids.community, actorId: ids.creator, newCaptainUserId: ids.member })
      ).toBe("captain_source_unavailable");
      const untouched = await db.communityTeam.findUniqueOrThrow({ where: { id: ids.team } });
      expect(untouched.createdById).toBe(ids.creator);
      expect(await service.getTeamCaptain({ teamId: ids.team, communityId: ids.community })).toEqual({
        status: "found",
        captainId: ids.creator,
        captainName: "Maxime",
        source: "createdById",
      });
      return;
    }

    const before = await db.communityTeam.findUniqueOrThrow({ where: { id: ids.team } });
    expect((before as unknown as { captainId: string | null }).captainId).toBeNull();
    expect(await service.transferTeamCaptain({ teamId: ids.team, communityId: ids.community, actorId: ids.creator, newCaptainUserId: ids.member })).toBe(
      "transferred"
    );

    const after = await db.communityTeam.findUniqueOrThrow({ where: { id: ids.team } });
    expect(after.createdById).toBe(ids.creator);
    expect((after as unknown as { captainId: string | null }).captainId).toBe(ids.member);
    expect(await service.getTeamCaptain({ teamId: ids.team, communityId: ids.community })).toEqual({
      status: "found",
      captainId: ids.member,
      captainName: "Sarah",
      source: "captainId",
    });

    // L'ancien capitaine ne peut plus transférer : la mise à jour est conditionnelle.
    expect(await service.transferTeamCaptain({ teamId: ids.team, communityId: ids.community, actorId: ids.creator, newCaptainUserId: ids.member })).toBe(
      "not_captain"
    );
    const final = await db.communityTeam.findUniqueOrThrow({ where: { id: ids.team } });
    expect(final.createdById).toBe(ids.creator);
    expect((final as unknown as { captainId: string | null }).captainId).toBe(ids.member);
  });
});
