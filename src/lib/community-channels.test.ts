import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR3 — salons Discord par communauté, derrière
 * `COMMUNITY_CHANNELS_ENABLED` (éteint par défaut). Éteint : exactement la
 * configuration d'environnement historique. Allumé : `CommunityChannelConfig`
 * de la communauté, avec repli sur l'environnement UNIQUEMENT pour la
 * communauté `default` — jamais pour une autre (une annonce ne doit jamais
 * partir dans le salon d'une autre communauté).
 */

const { communityFindUnique, membershipFindMany } = vi.hoisted(() => ({
  communityFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique: communityFindUnique },
    membership: { findMany: membershipFindMany },
  },
}));

import {
  isCommunityChannelsEnabled,
  isSessionAnnounceViaBotEnabledFor,
  isTournamentAnnounceViaBotEnabledFor,
  pickCreationCommunityId,
  resolveSessionAnnounceConfig,
  resolveTournamentAnnounceConfig,
  resolveVoiceChannelUrl,
} from "./community-channels";

const ENV_SESSION = { guildId: "111", channelId: "900" };
const ENV_TOURNAMENT = { guildId: "111", channelId: "901" };

const community = (over: Record<string, unknown> = {}) => ({
  id: "c-b",
  slug: "serveur-b",
  status: "ACTIVE",
  discordGuildId: "333",
  channelConfigs: [] as Array<{ discordChannelId: string; enabled: boolean }>,
  ...over,
});
const withRow = (channelId: string, enabled = true) => [{ discordChannelId: channelId, enabled }];

describe("community-channels", () => {
  beforeEach(() => {
    communityFindUnique.mockReset().mockResolvedValue(null);
    membershipFindMany.mockReset().mockResolvedValue([]);
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "900");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "901");
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("construit un lien vocal Discord depuis la config active de la communauté", async () => {
    communityFindUnique.mockResolvedValue(community({ discordGuildId: "333333333333333333", channelConfigs: [{ discordChannelId: "444444444444444444", enabled: true }] }));
    await expect(resolveVoiceChannelUrl("c-b")).resolves.toBe("https://discord.com/channels/333333333333333333/444444444444444444");
    expect(communityFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c-b" }, include: expect.any(Object) }));
  });

  it("ne renvoie aucun lien vocal si la feature est désactivée", async () => {
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    await expect(resolveVoiceChannelUrl("c-b")).resolves.toBeNull();
    expect(communityFindUnique).not.toHaveBeenCalled();
  });

  describe("interrupteur COMMUNITY_CHANNELS_ENABLED", () => {
    it.each(["", "false", "TRUE", "1"])("valeur %j : éteint (seule `true` exacte active)", (v) => {
      vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", v);
      expect(isCommunityChannelsEnabled()).toBe(false);
    });

    it("éteint : environnement historique seulement pour default, aucun repli d'un serveur identifié", async () => {
      vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "");
      await expect(resolveSessionAnnounceConfig(null)).resolves.toEqual(ENV_SESSION);
      await expect(resolveTournamentAnnounceConfig(null)).resolves.toEqual(ENV_TOURNAMENT);
      expect(communityFindUnique).not.toHaveBeenCalled();
      communityFindUnique.mockResolvedValue(community());
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toBeNull();
      await expect(resolveTournamentAnnounceConfig("c-b")).resolves.toBeNull();
      communityFindUnique.mockResolvedValue(community({ slug: "default" }));
      await expect(resolveSessionAnnounceConfig("c-def")).resolves.toEqual(ENV_SESSION);
      communityFindUnique.mockResolvedValue(community({ slug: "default", status: "SUSPENDED" }));
      await expect(resolveSessionAnnounceConfig("c-def")).resolves.toBeNull();
    });

    it("éteint et environnement incomplet : null (comportement historique)", async () => {
      vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "");
      vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "");
      await expect(resolveSessionAnnounceConfig(null)).resolves.toBeNull();
    });

    it("isolation active : default absente ou suspendue refuse tout repli historique", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      for (const enabled of ["", "true"]) {
        vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", enabled);
        communityFindUnique.mockResolvedValue(null);
        await expect(resolveSessionAnnounceConfig(null)).resolves.toBeNull();
        communityFindUnique.mockResolvedValue(community({ slug: "default", status: "SUSPENDED" }));
        await expect(resolveTournamentAnnounceConfig(null)).resolves.toBeNull();
      }
    });
  });

  describe("communauté par défaut (communityId null ou slug default)", () => {
    const defaultCommunity = (over: Record<string, unknown> = {}) =>
      community({ id: "c-def", slug: "default", discordGuildId: "111", ...over });

    it("communityId null : cherche la communauté `default` par son slug", async () => {
      communityFindUnique.mockResolvedValue(defaultCommunity());
      await resolveSessionAnnounceConfig(null);
      expect(communityFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "default" } })
      );
    });

    it("sans configuration de salon : repli sur l'environnement", async () => {
      communityFindUnique.mockResolvedValue(defaultCommunity());
      await expect(resolveSessionAnnounceConfig(null)).resolves.toEqual(ENV_SESSION);
      await expect(resolveTournamentAnnounceConfig(null)).resolves.toEqual(ENV_TOURNAMENT);
    });

    it("avec une configuration de salon : la base prime sur l'environnement", async () => {
      communityFindUnique.mockResolvedValue(defaultCommunity({ channelConfigs: withRow("777") }));
      await expect(resolveSessionAnnounceConfig(null)).resolves.toEqual({ guildId: "111", channelId: "777" });
    });

    it("configuration désactivée (enabled=false) : null, PAS de repli sur l'environnement", async () => {
      communityFindUnique.mockResolvedValue(defaultCommunity({ channelConfigs: withRow("777", false) }));
      await expect(resolveSessionAnnounceConfig(null)).resolves.toBeNull();
    });

    it("communauté par défaut absente de la base : environnement (historique)", async () => {
      communityFindUnique.mockResolvedValue(null);
      await expect(resolveSessionAnnounceConfig(null)).resolves.toEqual(ENV_SESSION);
    });

    it("sans discordGuildId mais salon configuré : serveur repris de l'environnement", async () => {
      communityFindUnique.mockResolvedValue(
        defaultCommunity({ discordGuildId: null, channelConfigs: withRow("777") })
      );
      await expect(resolveSessionAnnounceConfig(null)).resolves.toEqual({ guildId: "111", channelId: "777" });
    });

    it("suspendue ou en attente : null, même avec l'environnement complet", async () => {
      communityFindUnique.mockResolvedValue(defaultCommunity({ status: "SUSPENDED" }));
      await expect(resolveSessionAnnounceConfig(null)).resolves.toBeNull();
    });
  });

  describe("autre communauté", () => {
    it("lit la configuration de SA catégorie (SESSION ou TOURNAMENT)", async () => {
      communityFindUnique.mockResolvedValue(community({ channelConfigs: withRow("555") }));
      await resolveTournamentAnnounceConfig("c-b");
      expect(communityFindUnique).toHaveBeenCalledWith({
        where: { id: "c-b" },
        include: { channelConfigs: { where: { category: "TOURNAMENT" } } },
      });
      await resolveSessionAnnounceConfig("c-b");
      expect(communityFindUnique).toHaveBeenLastCalledWith({
        where: { id: "c-b" },
        include: { channelConfigs: { where: { category: "SESSION" } } },
      });
    });

    it("active avec salon : serveur DE LA COMMUNAUTÉ + salon configuré", async () => {
      communityFindUnique.mockResolvedValue(community({ channelConfigs: withRow("555") }));
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toEqual({ guildId: "333", channelId: "555" });
    });

    it("sans salon configuré : null — JAMAIS le salon de l'environnement (celui de default)", async () => {
      communityFindUnique.mockResolvedValue(community());
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toBeNull();
      await expect(resolveTournamentAnnounceConfig("c-b")).resolves.toBeNull();
    });

    it("salon désactivé : null", async () => {
      communityFindUnique.mockResolvedValue(community({ channelConfigs: withRow("555", false) }));
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toBeNull();
    });

    it.each(["PENDING", "SUSPENDED", "LEFT", "ARCHIVED"])("statut %s : null même avec un salon configuré", async (status) => {
      communityFindUnique.mockResolvedValue(community({ status, channelConfigs: withRow("555") }));
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toBeNull();
    });

    it("sans serveur Discord (discordGuildId null) : null, pas d'emprunt de l'environnement", async () => {
      communityFindUnique.mockResolvedValue(community({ discordGuildId: null, channelConfigs: withRow("555") }));
      await expect(resolveSessionAnnounceConfig("c-b")).resolves.toBeNull();
    });

    it("communauté introuvable : null (pas de repli sur default)", async () => {
      communityFindUnique.mockResolvedValue(null);
      await expect(resolveSessionAnnounceConfig("c-inconnue")).resolves.toBeNull();
    });
  });

  describe("interrupteurs de catégorie (…_ANNOUNCE_ENABLED)", () => {
    beforeEach(() => {
      communityFindUnique.mockResolvedValue(community({ channelConfigs: withRow("555") }));
    });

    it("soirées : exige DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true ET une configuration résolue", async () => {
      await expect(isSessionAnnounceViaBotEnabledFor("c-b")).resolves.toBe(false);
      vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
      await expect(isSessionAnnounceViaBotEnabledFor("c-b")).resolves.toBe(true);
      communityFindUnique.mockResolvedValue(community());
      await expect(isSessionAnnounceViaBotEnabledFor("c-b")).resolves.toBe(false);
    });

    it("tournois : exige DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED=true ET une configuration résolue", async () => {
      await expect(isTournamentAnnounceViaBotEnabledFor("c-b")).resolves.toBe(false);
      vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "true");
      await expect(isTournamentAnnounceViaBotEnabledFor("c-b")).resolves.toBe(true);
    });
  });

  describe("pickCreationCommunityId", () => {
    const membership = (communityId: string, slug: string) => ({ communityId, community: { slug } });

    it("éteint : null, aucune lecture", async () => {
      vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "");
      await expect(pickCreationCommunityId("u1")).resolves.toBeNull();
      expect(membershipFindMany).not.toHaveBeenCalled();
    });

    it("salons éteints mais isolation allumée : résout aussi la communauté (le créateur doit voir sa propre soirée)", async () => {
      vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "");
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      membershipFindMany.mockResolvedValue([membership("c-b", "serveur-b")]);
      await expect(pickCreationCommunityId("u1")).resolves.toBe("c-b");
    });

    it("ne considère que les Memberships ACTIVE de communautés ACTIVE, du plus ancien au plus récent", async () => {
      await pickCreationCommunityId("u1");
      expect(membershipFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "u1", status: "ACTIVE", community: { status: "ACTIVE" } },
          orderBy: { joinedAt: "asc" },
        })
      );
    });

    it("aucune communauté : null (= communauté par défaut)", async () => {
      await expect(pickCreationCommunityId("u1")).resolves.toBeNull();
    });

    it("une seule : celle-ci", async () => {
      membershipFindMany.mockResolvedValue([membership("c-b", "serveur-b")]);
      await expect(pickCreationCommunityId("u1")).resolves.toBe("c-b");
    });

    it("plusieurs dont la communauté par défaut : la communauté par défaut (en attendant le choix explicite)", async () => {
      membershipFindMany.mockResolvedValue([membership("c-b", "serveur-b"), membership("c-def", "default")]);
      await expect(pickCreationCommunityId("u1")).resolves.toBe("c-def");
    });

    it("plusieurs sans la communauté par défaut : la plus ancienne", async () => {
      membershipFindMany.mockResolvedValue([membership("c-b", "serveur-b"), membership("c-c", "serveur-c")]);
      await expect(pickCreationCommunityId("u1")).resolves.toBe("c-b");
    });
  });
});
