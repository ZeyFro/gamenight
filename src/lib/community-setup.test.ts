import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Activation d'une communauté par `/gamenight setup` : idempotente, sans course,
 * et SUSPENDED / ARCHIVED ne se contournent jamais.
 */

const { findUnique, updateMany, userFindUnique, provision } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  userFindUnique: vi.fn(),
  provision: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findUnique, updateMany }, user: { findUnique: userFindUnique } },
}));
vi.mock("@/lib/community-provisioning", () => ({ provisionCommunityFromGuild: provision }));

import { setupCommunityFromGuild } from "./community-setup";

const GUILD_ID = "123456789012345678";

describe("setupCommunityFromGuild", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(null);
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    userFindUnique.mockReset().mockResolvedValue({ id: "u1" });
    provision.mockReset().mockResolvedValue({ action: "created", communityId: "c-new" });
  });

  it("serveur inconnu : provisionne (nom provisoire) puis active", async () => {
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toEqual({
      action: "activated",
      communityId: "c-new",
    });
    expect(provision).toHaveBeenCalledWith({ id: GUILD_ID, name: "Serveur 345678", icon: null }, "777");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c-new", status: { in: ["PENDING", "LEFT"] } },
      data: { status: "ACTIVE", activatedAt: expect.any(Date), activatedById: "u1", leftAt: null },
    });
  });

  it.each(["PENDING", "LEFT"])("communauté %s existante : activée sans recréer ni renommer", async (status) => {
    findUnique.mockResolvedValue({ id: "c1", status });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toEqual({
      action: "activated",
      communityId: "c1",
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("déjà ACTIVE : aucune écriture", async () => {
    findUnique.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toEqual({
      action: "already_active",
      communityId: "c1",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it.each(["SUSPENDED", "ARCHIVED"])("%s : bloqué, jamais réactivé", async (status) => {
    findUnique.mockResolvedValue({ id: "c1", status });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toEqual({
      action: "blocked",
      communityId: "c1",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("création concurrente refusée par le provisionnement (`ignored`) : bloqué", async () => {
    provision.mockResolvedValue({ action: "ignored", communityId: "c1" });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toMatchObject({ action: "blocked" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("course : l'update conditionnel n'a rien touché, un autre appel l'a activée = already_active", async () => {
    findUnique.mockResolvedValueOnce({ id: "c1", status: "PENDING" }).mockResolvedValueOnce({ status: "ACTIVE" });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toEqual({
      action: "already_active",
      communityId: "c1",
    });
  });

  it("course : statut devenu SUSPENDED entre-temps = blocked", async () => {
    findUnique.mockResolvedValueOnce({ id: "c1", status: "PENDING" }).mockResolvedValueOnce({ status: "SUSPENDED" });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(setupCommunityFromGuild(GUILD_ID, "777")).resolves.toMatchObject({ action: "blocked" });
  });

  it("l'activateur sans compte GameNight : activatedById null", async () => {
    findUnique.mockResolvedValue({ id: "c1", status: "PENDING" });
    userFindUnique.mockResolvedValue(null);
    await setupCommunityFromGuild(GUILD_ID, "777");
    expect(updateMany.mock.calls[0][0].data.activatedById).toBeNull();
  });

  it("identifiant de serveur invalide : erreur, aucun accès base", async () => {
    await expect(setupCommunityFromGuild("abc", "777")).rejects.toThrow();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
