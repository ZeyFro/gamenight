import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rattrapage par cron (`GET /users/@me/guilds`) : crée en PENDING les
 * communautés que le webhook a manquées et marque LEFT celles dont le bot est
 * parti. Fail-safe : une liste incomplète, vide ou en erreur ne marque JAMAIS
 * rien LEFT.
 */

const { listBotGuilds, provision, findMany, update } = vi.hoisted(() => ({
  listBotGuilds: vi.fn(),
  provision: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/discord-rest", () => ({ listBotGuilds }));
vi.mock("@/lib/community-provisioning", () => ({ provisionCommunityFromGuild: provision }));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findMany, update } } }));

import { syncCommunitiesWithBotGuilds } from "./community-guild-sync";

const NOW = new Date("2026-10-04T20:00:00Z");
const deadline = new Date(NOW.getTime() + 20_000);
const g = (id: string) => ({ id, name: `Serveur ${id}`, icon: null });
const page = (ids: string[]) => ({ ok: true as const, data: { guilds: ids.map(g) } });
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i));
const run = () => syncCommunitiesWithBotGuilds({ deadline, now: NOW });

describe("syncCommunitiesWithBotGuilds", () => {
  beforeEach(() => {
    listBotGuilds.mockReset().mockResolvedValue(page(["111", "222"]));
    provision.mockReset().mockImplementation(async (guild) => ({ action: "created", communityId: `c-${guild.id}` }));
    findMany.mockReset().mockResolvedValue([]);
    update.mockReset().mockResolvedValue({});
  });

  it("crée chaque serveur du bot via provisionCommunityFromGuild (sans installateur)", async () => {
    const result = await run();
    expect(provision).toHaveBeenCalledWith(g("111"), null);
    expect(provision).toHaveBeenCalledWith(g("222"), null);
    expect(result).toMatchObject({ ok: true, guilds: 2, created: 2, markedLeft: 0 });
  });

  it("pagine par `after` tant que la page est pleine (200)", async () => {
    listBotGuilds
      .mockResolvedValueOnce(page(range(1000, 200)))
      .mockResolvedValueOnce(page(["5"]));
    const result = await run();
    expect(listBotGuilds).toHaveBeenCalledTimes(2);
    expect(listBotGuilds.mock.calls[0][0]).toMatchObject({ after: undefined });
    expect(listBotGuilds.mock.calls[1][0]).toMatchObject({ after: "1199" });
    expect(result).toMatchObject({ ok: true, guilds: 201 });
  });

  it("marque LEFT une communauté PENDING/ACTIVE dont le serveur n'est plus dans la liste", async () => {
    findMany.mockResolvedValue([
      { id: "c-111", slug: "a-111", discordGuildId: "111" },
      { id: "c-gone", slug: "parti-999", discordGuildId: "999" },
    ]);
    const result = await run();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["PENDING", "ACTIVE"] }, discordGuildId: { not: null } },
      })
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "c-gone" },
      data: { status: "LEFT", leftAt: NOW },
    });
    expect(result).toMatchObject({ markedLeft: 1 });
  });

  it("la communauté `default` n'est jamais marquée LEFT automatiquement (verrouillerait tout le monde)", async () => {
    findMany.mockResolvedValue([{ id: "c-def", slug: "default", discordGuildId: "999" }]);
    const result = await run();
    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ markedLeft: 0, skippedDefault: true });
  });

  it("liste vide : aucun LEFT (jeton révoqué ou panne ≠ départ de tous les serveurs)", async () => {
    listBotGuilds.mockResolvedValue(page([]));
    findMany.mockResolvedValue([{ id: "c-1", slug: "a-1", discordGuildId: "1" }]);
    const result = await run();
    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, guilds: 0, markedLeft: 0 });
  });

  it("erreur Discord sur une page : rien n'est écrit", async () => {
    listBotGuilds
      .mockResolvedValueOnce(page(range(1000, 200)))
      .mockResolvedValueOnce({ ok: false, kind: "server_error", message: "500", retryable: true });
    const result = await run();
    expect(result).toMatchObject({ ok: false });
    expect(provision).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("plafond de pages atteint (liste potentiellement incomplète) : rien n'est écrit", async () => {
    listBotGuilds.mockImplementation(async ({ after }: { after?: string }) =>
      page(range(Number(after ?? 0) + 1, 200))
    );
    const result = await run();
    expect(result).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it("un serveur en échec de création n'empêche pas les autres et bloque les LEFT (liste de références incertaine)", async () => {
    provision.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    findMany.mockResolvedValue([{ id: "c-gone", slug: "parti-999", discordGuildId: "999" }]);
    const result = await run();
    expect(provision).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, failed: 1, created: 1, markedLeft: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
