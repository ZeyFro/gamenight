import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Création automatique d'une communauté quand le bot est ajouté à un serveur
 * (webhook `APPLICATION_AUTHORIZED` ou cron `GET /users/@me/guilds`). Une
 * nouvelle communauté démarre TOUJOURS en `PENDING` : jamais d'accès ni de
 * Membership avant l'activation par un admin.
 */

const { findUnique, create, update, updateMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique, create, update, updateMany } } }));

import { communitySlug, provisionCommunityFromGuild } from "./community-provisioning";

const GUILD = { id: "123456789012345678", name: "Les Potes de Lyon", icon: "abc123" };
const uniqueViolation = () => Object.assign(new Error("Unique constraint"), { code: "P2002" });

describe("communitySlug", () => {
  it("minuscules ASCII, sans accents ni symboles, suffixé par la fin de l'id du serveur", () => {
    expect(communitySlug("Les Potes de Lyon", "123456789012345678")).toBe("les-potes-de-lyon-345678");
    expect(communitySlug("Été Ünïcode !!", "999111")).toBe("ete-unicode-999111");
  });

  it("nom vide ou sans caractère exploitable : base `serveur`", () => {
    expect(communitySlug("🎮🎮", "111222")).toBe("serveur-111222");
  });

  it("jamais `default` (réservé) et longueur bornée", () => {
    expect(communitySlug("default", "111222")).not.toBe("default");
    expect(communitySlug("x".repeat(200), "111222").length).toBeLessThanOrEqual(48);
  });
});

describe("provisionCommunityFromGuild", () => {
  beforeEach(() => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    findUnique.mockReset().mockResolvedValue(null);
    create.mockReset().mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
    update.mockReset().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  });

  it("serveur inconnu : crée la communauté en PENDING avec l'installateur", async () => {
    const result = await provisionCommunityFromGuild(GUILD, "777");
    expect(create).toHaveBeenCalledWith({
      data: {
        slug: "les-potes-de-lyon-345678",
        name: "Les Potes de Lyon",
        discordGuildId: GUILD.id,
        iconHash: "abc123",
        status: "PENDING",
        installedByDiscordId: "777",
      },
    });
    expect(result).toEqual({ action: "created", communityId: "c1" });
  });

  it("jamais ACTIVE ni activatedAt à la création", async () => {
    await provisionCommunityFromGuild(GUILD, null);
    const { data } = create.mock.calls[0][0];
    expect(data.status).toBe("PENDING");
    expect(data).not.toHaveProperty("activatedAt");
    expect(data.installedByDiscordId).toBeNull();
  });

  it.each(["PENDING", "ACTIVE"])(
    "déjà connue (%s) : met à jour nom et icône seulement, statut et installateur intacts",
    async (status) => {
      findUnique.mockResolvedValue({ id: "c1", status, name: "Ancien", iconHash: null });
      const result = await provisionCommunityFromGuild(GUILD, "777");
      expect(update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { name: "Les Potes de Lyon", iconHash: "abc123" },
      });
      expect(create).not.toHaveBeenCalled();
      expect(result).toEqual({ action: "updated", communityId: "c1" });
    }
  );

  it("bot réajouté après un départ (LEFT) : repasse en PENDING, leftAt effacé (réactivation par un admin)", async () => {
    findUnique.mockResolvedValue({ id: "c1", status: "LEFT", name: "Ancien", iconHash: null });
    const result = await provisionCommunityFromGuild(GUILD, "777");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c1", status: "LEFT" },
      data: { name: "Les Potes de Lyon", iconHash: "abc123", status: "PENDING", leftAt: null },
    });
    expect(result).toEqual({ action: "reset_pending", communityId: "c1" });
  });
  it.each(["ACTIVE", "SUSPENDED", "ARCHIVED"])("LEFT relu pendant un setup/admin concurrent devenu %s : aucun retour en PENDING", async (status) => {
    findUnique.mockResolvedValueOnce({ id: "c1", status: "LEFT", name: "Ancien", iconHash: null })
      .mockResolvedValueOnce({ id: "c1", status, name: GUILD.name, iconHash: GUILD.icon });
    updateMany.mockResolvedValue({ count: 0 });
    expect(await provisionCommunityFromGuild(GUILD, null)).toEqual({ action: status === "ACTIVE" ? "unchanged" : "ignored", communityId: "c1" });
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["SUSPENDED", "ARCHIVED"])("%s : jamais modifiée (une suspension ne se contourne pas)", async (status) => {
    findUnique.mockResolvedValue({ id: "c1", status, name: "Ancien", iconHash: null });
    const result = await provisionCommunityFromGuild(GUILD, "777");
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "ignored", communityId: "c1" });
  });

  it("création simultanée (webhook + cron, P2002 sur le serveur) : relit la ligne du gagnant", async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "c9", status: "PENDING", name: GUILD.name, iconHash: "abc123" });
    create.mockRejectedValueOnce(uniqueViolation());
    const result = await provisionCommunityFromGuild(GUILD, "777");
    expect(result.communityId).toBe("c9");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("slug déjà pris par un autre serveur (P2002 sans gagnant) : réessaie avec l'id complet du serveur", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValueOnce(uniqueViolation());
    await provisionCommunityFromGuild(GUILD, "777");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].data.slug).toBe(`les-potes-de-lyon-${GUILD.id}`);
  });

  it("autre erreur de base : remonte", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(provisionCommunityFromGuild(GUILD, "777")).rejects.toThrow("db down");
  });

  it("identifiant de serveur invalide : refusé avant toute écriture", async () => {
    await expect(provisionCommunityFromGuild({ ...GUILD, id: "abc" }, null)).rejects.toThrow(/invalide/);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
