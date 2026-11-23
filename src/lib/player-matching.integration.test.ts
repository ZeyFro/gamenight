import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});

describe.skipIf(!url)("partenaires compatibles (§12.3) : jeux en commun et réponses déclarées", () => {
  let db: PrismaClient;
  let matching: typeof import("./player-matching");
  const scope = "match-" + randomUUID();
  const id = (name: string) => scope + "-" + name;
  const names = ["viewer", "twin", "gamer", "stranger", "hidden"];
  const games = ["g1", "g2", "g3"];

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    matching = await import("./player-matching");
  });
  async function clean() {
    await db.userGame.deleteMany({ where: { userId: { in: names.map(id) } } });
    await db.game.deleteMany({ where: { id: { in: games.map(id) } } });
    await db.user.deleteMany({ where: { id: { in: names.map(id) } } });
  }
  afterAll(async () => { if (db) { await clean(); await db.$disconnect(); } });
  beforeEach(async () => {
    await clean();
    const profile = { languages: ["FR"], playHabits: ["WEEKEND"], communityPreferences: ["CHILL"], availablePlatforms: ["WINDOWS"] };
    await db.user.createMany({ data: [
      { id: id("viewer"), discordId: id("viewer"), discordName: "viewer", ...profile },
      { id: id("twin"), discordId: id("twin"), discordName: "twin", ...profile },
      { id: id("gamer"), discordId: id("gamer"), discordName: "gamer", languages: ["EN"] },
      { id: id("stranger"), discordId: id("stranger"), discordName: "stranger", ...profile },
      { id: id("hidden"), discordId: id("hidden"), discordName: "hidden", ...profile },
    ] });
    await db.game.createMany({ data: games.map(game => ({ id: id(game), name: id(game), source: "MANUAL" as const, addedById: id("viewer") })) });
    const own = (user: string, game: string, owned = true) => ({ userId: id(user), gameId: id(game), owned });
    await db.userGame.createMany({ data: [
      own("viewer", "g1"), own("viewer", "g2"),
      own("twin", "g1"), own("twin", "g2"),
      own("gamer", "g1"), own("gamer", "g2"),
      own("hidden", "g1"),
      own("stranger", "g3"), own("stranger", "g1", false),
    ] });
  });

  it("classe les candidats fournis, exige un jeu possédé en commun et un autre point commun", async () => {
    const result = await matching.loadCompatiblePartners(id("viewer"), [id("twin"), id("gamer"), id("stranger")]);
    expect(result.map(row => row.userId)).toEqual([id("twin")]);
    expect(result[0].reasons[0]).toBe("2 jeux en commun");
  });

  it("ne lit que les candidats autorisés par l'appelant (un profil masqué absent de la liste n'est jamais proposé)", async () => {
    const result = await matching.loadCompatiblePartners(id("viewer"), [id("gamer"), id("viewer")]);
    expect(result).toEqual([]);
    expect((await matching.loadCompatiblePartners(id("viewer"), [id("hidden"), id("twin")])).map(row => row.userId)).toEqual([id("twin"), id("hidden")]);
    expect(await matching.loadCompatiblePartners(id("viewer"), [id("twin")])).toHaveLength(1);
  });
});
