import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, écran d'administration — drapeau `COMMUNITY_ADMIN_ENABLED`
 * (exactement `true`), activation d'une communauté PENDING et choix des salons
 * SESSION / TOURNAMENT. Un salon n'est enregistré qu'après un `GET` Discord réel
 * confirmant qu'il appartient au serveur de la communauté (aucun envoi).
 */

const { communityFindUnique, communityUpdateMany, configUpsert, verifyChannelDestination, verifyVoiceChannelDestination } = vi.hoisted(() => ({
  communityFindUnique: vi.fn(),
  communityUpdateMany: vi.fn(),
  configUpsert: vi.fn(),
  verifyChannelDestination: vi.fn(),
  verifyVoiceChannelDestination: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique: communityFindUnique, updateMany: communityUpdateMany },
    communityChannelConfig: { upsert: configUpsert },
  },
}));
vi.mock("@/lib/discord-rest", () => ({ verifyChannelDestination, verifyVoiceChannelDestination }));

import {
  activateCommunity,
  isCommunityAdminEnabled,
  parseChannelCategory,
  setCommunityGuide,
  setCommunityGroupPurchasePlans,
  setCommunityTeams,
  setCommunityChannel,
} from "./community-admin";

const community = (over: Record<string, unknown> = {}) => ({
  id: "c-b",
  slug: "serveur-b",
  status: "PENDING",
  discordGuildId: "333333333333333333",
  ...over,
});
const CHANNEL = "444444444444444444";

describe("isCommunityAdminEnabled", () => {
  it("n'est actif que pour la valeur exacte `true`", () => {
    expect(isCommunityAdminEnabled({ COMMUNITY_ADMIN_ENABLED: "true" })).toBe(true);
  });

  it.each([undefined, "", "TRUE", "True", "1", "yes", "false", " true", "true "])("est éteint pour %j", (value) => {
    expect(isCommunityAdminEnabled({ COMMUNITY_ADMIN_ENABLED: value })).toBe(false);
  });
});

describe("parseChannelCategory", () => {
  it("accepte SESSION et TOURNAMENT, rien d'autre", () => {
    expect(parseChannelCategory("SESSION")).toBe("SESSION");
    expect(parseChannelCategory("TOURNAMENT")).toBe("TOURNAMENT");
    expect(parseChannelCategory("VOICE")).toBe("VOICE");
    for (const v of ["session", "", "DM", null, undefined, 3]) expect(parseChannelCategory(v)).toBeNull();
  });
});

describe("setCommunityGuide", () => {
  beforeEach(() => communityUpdateMany.mockReset().mockResolvedValue({ count: 1 }));

  it("refuse les valeurs non textuelles et les dépassements sans écrire", async () => {
    for (const input of [
      { communityId: "c", rules: { name: "rules.txt" }, contacts: "" },
      { communityId: "c", rules: "x".repeat(4001), contacts: "" },
      { communityId: "c", rules: "", contacts: "x".repeat(2001) },
    ]) expect(await setCommunityGuide(input)).toBe("invalid");
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it("enregistre le texte nettoyé uniquement pour une communauté éditable", async () => {
    expect(await setCommunityGuide({ communityId: "c", rules: " Règles\n ", contacts: "  @admin " })).toBe("saved");
    expect(communityUpdateMany).toHaveBeenCalledWith({
      where: { id: "c", status: { in: ["PENDING", "ACTIVE"] } },
      data: { guideRules: "Règles", guideContacts: "@admin" },
    });
  });

  it("efface les champs vides et signale une communauté devenue indisponible", async () => {
    communityUpdateMany.mockResolvedValue({ count: 0 });
    expect(await setCommunityGuide({ communityId: "c", rules: " ", contacts: null })).toBe("unavailable");
    expect(communityUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { guideRules: null, guideContacts: null },
    }));
  });
});

describe("setCommunityGroupPurchasePlans", () => {
  beforeEach(() => communityUpdateMany.mockReset().mockResolvedValue({ count: 1 }));

  it("toggles only an editable community and rejects malformed settings", async () => {
    expect(await setCommunityGroupPurchasePlans({ communityId: "c-b", enabled: true })).toBe("saved");
    expect(communityUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-b", status: { in: ["PENDING", "ACTIVE"] } },
      data: { groupPurchasePlansEnabled: true },
    });
    expect(await setCommunityGroupPurchasePlans({ communityId: "", enabled: true })).toBe("invalid");
    expect(await setCommunityGroupPurchasePlans({ communityId: "c-b", enabled: "true" })).toBe("invalid");
    expect(communityUpdateMany).toHaveBeenCalledTimes(1);
  });
});

describe("setCommunityTeams", () => {
  beforeEach(() => communityUpdateMany.mockReset().mockResolvedValue({ count: 1 }));

  it("requires a boolean and only toggles active communities", async () => {
    expect(await setCommunityTeams({ communityId: "c-b", enabled: true })).toBe("saved");
    expect(communityUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-b", status: "ACTIVE" },
      data: { communityTeamsEnabled: true },
    });
    expect(await setCommunityTeams({ communityId: "c-b", enabled: "true" })).toBe("invalid");
    communityUpdateMany.mockResolvedValue({ count: 0 });
    expect(await setCommunityTeams({ communityId: "c-b", enabled: false })).toBe("unavailable");
  });
});

describe("activateCommunity", () => {
  beforeEach(() => {
    communityFindUnique.mockReset().mockResolvedValue(community());
    communityUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("passe une communauté PENDING en ACTIVE avec la trace de l'admin", async () => {
    expect(await activateCommunity("c-b", "admin-1")).toBe("activated");
    expect(communityUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-b", status: "PENDING" },
      data: { status: "ACTIVE", activatedAt: expect.any(Date), activatedById: "admin-1" },
    });
  });

  it("communauté introuvable : rien n'est écrit", async () => {
    communityFindUnique.mockResolvedValue(null);
    expect(await activateCommunity("x", "admin-1")).toBe("not_found");
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["ACTIVE", "SUSPENDED", "LEFT", "ARCHIVED"])("statut %s : jamais réactivé", async (status) => {
    communityFindUnique.mockResolvedValue(community({ status }));
    expect(await activateCommunity("c-b", "admin-1")).toBe("not_pending");
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it("sans serveur Discord connu : refusé", async () => {
    communityFindUnique.mockResolvedValue(community({ discordGuildId: null }));
    expect(await activateCommunity("c-b", "admin-1")).toBe("no_guild");
    expect(communityUpdateMany).not.toHaveBeenCalled();
  });

  it("changement de statut concurrent (0 ligne mise à jour) : not_pending", async () => {
    communityUpdateMany.mockResolvedValue({ count: 0 });
    expect(await activateCommunity("c-b", "admin-1")).toBe("not_pending");
  });
});

describe("setCommunityChannel", () => {
  beforeEach(() => {
    communityFindUnique.mockReset().mockResolvedValue(community({ status: "ACTIVE" }));
    configUpsert.mockReset().mockResolvedValue({});
    verifyChannelDestination.mockReset().mockResolvedValue({ ok: true, data: { channelId: CHANNEL } });
    verifyVoiceChannelDestination.mockReset().mockResolvedValue({ ok: true, data: { channelId: CHANNEL } });
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111111111111111111");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("vérifie le salon contre le serveur de la communauté puis l'enregistre (activé)", async () => {
    expect(await setCommunityChannel({ communityId: "c-b", category: "TOURNAMENT", channelId: CHANNEL })).toEqual({
      ok: true,
    });
    expect(verifyChannelDestination).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, guildId: "333333333333333333" })
    );
    expect(configUpsert).toHaveBeenCalledWith({
      where: { communityId_category: { communityId: "c-b", category: "TOURNAMENT" } },
      create: { communityId: "c-b", category: "TOURNAMENT", discordChannelId: CHANNEL, enabled: true },
      update: { discordChannelId: CHANNEL, enabled: true },
    });
  });

  it("accepte aussi une communauté PENDING (préparation avant activation)", async () => {
    communityFindUnique.mockResolvedValue(community());
    expect((await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).ok).toBe(true);
  });

  it("vérifie un salon vocal avec son validateur dédié", async () => {
    communityFindUnique.mockResolvedValue(community({ status: "ACTIVE" }));
    expect((await setCommunityChannel({ communityId: "c-b", category: "VOICE", channelId: CHANNEL })).ok).toBe(true);
    expect(verifyVoiceChannelDestination).toHaveBeenCalledWith(expect.objectContaining({ guildId: "333333333333333333" }));
    expect(verifyChannelDestination).not.toHaveBeenCalled();
  });

  it.each(["", "abc", "12345", "44444444444444444x", "4".repeat(30), " 444444444444444444"])(
    "identifiant %j invalide : aucun appel Discord, rien d'écrit",
    async (channelId) => {
      const r = await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId });
      expect(r).toEqual({ ok: false, reason: "invalid_channel" });
      expect(verifyChannelDestination).not.toHaveBeenCalled();
      expect(configUpsert).not.toHaveBeenCalled();
    }
  );

  it("communauté introuvable", async () => {
    communityFindUnique.mockResolvedValue(null);
    expect(await setCommunityChannel({ communityId: "x", category: "SESSION", channelId: CHANNEL })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(configUpsert).not.toHaveBeenCalled();
  });

  it.each(["SUSPENDED", "LEFT", "ARCHIVED"])("communauté %s : refusé", async (status) => {
    communityFindUnique.mockResolvedValue(community({ status }));
    expect(await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(verifyChannelDestination).not.toHaveBeenCalled();
  });

  it("communauté sans serveur Discord : refusé, jamais de repli sur l'environnement", async () => {
    communityFindUnique.mockResolvedValue(community({ discordGuildId: null }));
    expect(await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).toEqual({
      ok: false,
      reason: "no_guild",
    });
    expect(verifyChannelDestination).not.toHaveBeenCalled();
  });

  it("la communauté `default` sans serveur en base emprunte DISCORD_BOT_GUILD_ID", async () => {
    communityFindUnique.mockResolvedValue(community({ slug: "default", status: "ACTIVE", discordGuildId: null }));
    expect((await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).ok).toBe(true);
    expect(verifyChannelDestination).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "111111111111111111" })
    );
  });

  it("salon d'un autre serveur ou de type inutilisable (destination_mismatch) : rien n'est écrit", async () => {
    verifyChannelDestination.mockResolvedValue({ ok: false, kind: "destination_mismatch", message: "m", retryable: false });
    expect(await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).toEqual({
      ok: false,
      reason: "unusable_channel",
    });
    expect(configUpsert).not.toHaveBeenCalled();
  });

  it("Discord injoignable ou salon inconnu : rien n'est écrit", async () => {
    verifyChannelDestination.mockResolvedValue({ ok: false, kind: "not_found", message: "m", retryable: false });
    expect(await setCommunityChannel({ communityId: "c-b", category: "SESSION", channelId: CHANNEL })).toEqual({
      ok: false,
      reason: "verification_failed",
    });
    expect(configUpsert).not.toHaveBeenCalled();
  });
});
