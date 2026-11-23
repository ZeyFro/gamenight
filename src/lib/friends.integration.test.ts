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
if (!url) console.warn("[friends] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, amis NON validés sur SQL réel.");

describe.skipIf(!url)("Potes = amis (Postgres)", () => {
  let db: PrismaClient;
  let friends: typeof import("./friends");
  let access: typeof import("./community-isolation");
  const scope = "ami-" + randomUUID();
  const id = (name: string) => scope + "-" + name;
  const names = ["me", "you", "third", "outsider", "hidden"];
  const community = scope + "-c1";
  const otherCommunity = scope + "-c2";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    friends = await import("./friends");
    access = await import("./community-isolation");
  });
  async function clean() {
    await db.session.deleteMany({ where: { createdById: { in: names.map(id) } } });
    await db.friendship.deleteMany({ where: { OR: [{ requesterId: { in: names.map(id) } }, { addresseeId: { in: names.map(id) } }] } });
    await db.userProfileVisibility.deleteMany({ where: { userId: { in: names.map(id) } } });
    await db.membership.deleteMany({ where: { userId: { in: names.map(id) } } });
    await db.user.deleteMany({ where: { id: { in: names.map(id) } } });
    await db.community.deleteMany({ where: { id: { in: [community, otherCommunity] } } });
  }
  afterAll(async () => { if (db) { await clean(); await db.$disconnect(); } vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("POTES_FRIENDS_ENABLED", "true");
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    vi.stubEnv("SESSION_VISIBILITY_ENABLED", "true");
    await clean();
    await db.community.create({ data: { id: community, slug: community, name: "Serveur 1", status: "ACTIVE" } });
    await db.community.create({ data: { id: otherCommunity, slug: otherCommunity, name: "Serveur 2", status: "ACTIVE" } });
    await db.user.createMany({ data: names.map((name) => ({ id: id(name), discordId: id(name), discordName: name === "you" ? "Zey Fro" : name })) });
    for (const name of ["me", "you", "third", "hidden"]) await db.membership.create({ data: { userId: id(name), communityId: community, status: "ACTIVE" } });
    await db.membership.create({ data: { userId: id("outsider"), communityId: otherCommunity, status: "ACTIVE" } });
    await db.userProfileVisibility.create({ data: { userId: id("hidden"), visibility: "HIDDEN" } });
  });

  it("demande, demande croisée qui vaut acceptation, puis déjà amis", async () => {
    expect(await friends.sendFriendRequest(id("me"), id("you"))).toBe("sent");
    expect(await friends.sendFriendRequest(id("me"), id("you"))).toBe("already_sent");
    expect(await friends.getFriendRelation(id("you"), id("me"))).toBe("pending_received");
    expect(await friends.sendFriendRequest(id("you"), id("me"))).toBe("accepted");
    expect(await friends.sendFriendRequest(id("me"), id("you"))).toBe("already_friends");
    expect(await friends.listFriendIds(id("me"))).toEqual([id("you")]);
    expect(await friends.listFriendIds(id("you"))).toEqual([id("me")]);
    expect(await db.friendship.count({ where: { OR: [{ requesterId: id("me") }, { addresseeId: id("me") }] } })).toBe(1);
  });

  it("refuse soi-même, un inconnu, un autre serveur et un profil masqué (indistincts d'un inexistant)", async () => {
    expect(await friends.sendFriendRequest(id("me"), id("me"))).toBe("self");
    expect(await friends.sendFriendRequest(id("me"), "inexistant")).toBe("not_found");
    expect(await friends.sendFriendRequest(id("me"), id("outsider"))).toBe("not_found");
    expect(await friends.sendFriendRequest(id("me"), id("hidden"))).toBe("not_found");
    expect(await db.friendship.count({ where: { requesterId: id("me") } })).toBe(0);
  });

  it("flag éteint : aucune écriture, aucune lecture d'amis", async () => {
    vi.stubEnv("POTES_FRIENDS_ENABLED", "false");
    expect(await friends.sendFriendRequest(id("me"), id("you"))).toBe("disabled");
    expect(await friends.listFriendIds(id("me"))).toEqual([]);
    expect(await friends.searchMembersByName(id("me"), "Zey")).toEqual([]);
    expect(await db.friendship.count({ where: { requesterId: id("me") } })).toBe(0);
  });

  it("seul le destinataire répond, une seule fois ; le refus reste silencieux pour le demandeur", async () => {
    await friends.sendFriendRequest(id("me"), id("you"));
    const row = await db.friendship.findFirstOrThrow({ where: { requesterId: id("me") } });
    expect(await friends.respondFriendRequest(id("me"), row.id, true)).toBe("not_found");
    expect(await friends.respondFriendRequest(id("third"), row.id, true)).toBe("not_found");
    expect(await friends.respondFriendRequest(id("you"), row.id, false)).toBe("declined");
    expect(await friends.respondFriendRequest(id("you"), row.id, true)).toBe("not_found");
    // Le demandeur voit « envoyée » et ne peut pas renvoyer ; aucun refus n'est annoncé.
    expect(await friends.getFriendRelation(id("me"), id("you"))).toBe("pending_sent");
    expect(await friends.sendFriendRequest(id("me"), id("you"))).toBe("already_sent");
    expect((await friends.listFriendRequests(id("me"))).outgoing.map((r) => r.userId)).toEqual([id("you")]);
    expect((await friends.listFriendRequests(id("you"))).incoming).toEqual([]);
    // Celui qui a refusé peut demander plus tard : la ligne repasse en attente dans l'autre sens.
    expect(await friends.sendFriendRequest(id("you"), id("me"))).toBe("sent");
    expect(await friends.getFriendRelation(id("me"), id("you"))).toBe("pending_received");
    expect(await db.friendship.count({ where: { pairKey: row.pairKey } })).toBe(1);
  });

  it("le demandeur annule sa demande ; chacun peut retirer une amitié", async () => {
    await friends.sendFriendRequest(id("me"), id("you"));
    const row = await db.friendship.findFirstOrThrow({ where: { requesterId: id("me") } });
    expect(await friends.cancelFriendRequest(id("you"), row.id)).toBe(false);
    expect(await friends.cancelFriendRequest(id("me"), row.id)).toBe(true);
    expect(await friends.getFriendRelation(id("me"), id("you"))).toBe("none");
    await friends.sendFriendRequest(id("me"), id("you"));
    await friends.sendFriendRequest(id("you"), id("me"));
    expect(await friends.removeFriend(id("you"), id("me"))).toBe(true);
    expect(await friends.listFriendIds(id("me"))).toEqual([]);
    expect(await friends.removeFriend(id("you"), id("me"))).toBe(false);
  });

  it("recherche par pseudo : insensible à la casse, jamais moi, ni un autre serveur, ni un profil masqué ; relation affichée", async () => {
    await db.user.update({ where: { id: id("third") }, data: { discordName: "Zeyna" } });
    await db.user.update({ where: { id: id("outsider") }, data: { discordName: "Zeyo" } });
    await db.user.update({ where: { id: id("hidden") }, data: { discordName: "Zeyh" } });
    const hits = await friends.searchMembersByName(id("me"), "zey");
    expect(hits.map((hit) => hit.name)).toEqual(["Zey Fro", "Zeyna"]);
    expect(hits.every((hit) => hit.relation === "none")).toBe(true);
    await friends.sendFriendRequest(id("me"), id("you"));
    expect((await friends.searchMembersByName(id("me"), "Zey Fro")).map((hit) => hit.relation)).toEqual(["pending_sent"]);
    expect((await friends.searchMembersByName(id("you"), "me")).map((hit) => hit.relation)).toEqual(["pending_received"]);
    expect(await friends.searchMembersByName(id("me"), "z")).toEqual([]);
    expect(await friends.searchMembersByName(id("me"), "x".repeat(40))).toEqual([]);
    expect(await friends.searchMembersByName(id("me"), "me")).toEqual([]);
  });

  it("accès à une fiche : ami = complet, membre non ami = réduit, masqué ou autre serveur = introuvable", async () => {
    expect(await access.getPoteAccess(id("me"), id("me"))).toBe("self");
    expect(await access.getPoteAccess(id("me"), id("you"))).toBe("stranger");
    expect(await access.canViewPote(id("me"), id("you"))).toBe(false);
    expect(await access.getPoteAccess(id("me"), id("hidden"))).toBe("none");
    expect(await access.getPoteAccess(id("me"), id("outsider"))).toBe("none");
    await friends.sendFriendRequest(id("me"), id("you"));
    expect(await access.getPoteAccess(id("me"), id("you"))).toBe("stranger");
    await friends.sendFriendRequest(id("you"), id("me"));
    expect(await access.getPoteAccess(id("me"), id("you"))).toBe("friend");
    expect(await access.canViewPote(id("you"), id("me"))).toBe(true);
    // Flag éteint : tout membre visible reste « friend » comme avant, la table n'est plus lue.
    vi.stubEnv("POTES_FRIENDS_ENABLED", "false");
    expect(await access.getPoteAccess(id("me"), id("third"))).toBe("friend");
    expect(await access.getPoteAccess(id("me"), id("hidden"))).toBe("none");
  });

  it("un non-ami voit si une soirée à venir est publique (on peut la rejoindre) ou privée (sur invitation), sans détail des privées", async () => {
    const future = (days: number) => new Date(Date.now() + days * 86_400_000);
    const make = (days: number, visibility: "PUBLIC" | "PRIVATE" | "APPLICATION", extra: Record<string, unknown> = {}) =>
      db.session.create({ data: { date: future(days), createdById: id("you"), communityId: community, visibility, status: "SCHEDULED", ...extra } });
    const pub = await make(3, "PUBLIC");
    const app = await make(4, "APPLICATION");
    await make(5, "PRIVATE");
    await make(6, "PRIVATE");
    await make(-2, "PUBLIC");
    await make(7, "PUBLIC", { status: "CANCELLED" });
    await db.session.create({ data: { date: future(8), createdById: id("third"), communityId: community, visibility: "PUBLIC", status: "SCHEDULED" } });
    const result = await friends.listStrangerSessions(id("me"), id("you"));
    expect(result.open.map((row) => [row.id, row.kind])).toEqual([[pub.id, "PUBLIC"], [app.id, "APPLICATION"]]);
    expect(result.privateCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    // Visibilité des soirées éteinte : toutes comptent comme privées.
    vi.stubEnv("SESSION_VISIBILITY_ENABLED", "false");
    const off = await friends.listStrangerSessions(id("me"), id("you"));
    expect(off.open).toEqual([]);
    expect(off.privateCount).toBe(4);
  });
});
