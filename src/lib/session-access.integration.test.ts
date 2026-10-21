import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Chantier confidentialité des soirées — tests d'intégration Postgres
 * isolée pour `src/lib/session-access.ts`, la SEULE source de vérité du
 * contrôle d'accès serveur (créateur + invités `ACTIVE`). Réel moteur
 * Postgres requis (pas de mock Prisma) : la garantie centrale de ce
 * module ("un utilisateur non invité n'obtient jamais la moindre donnée,
 * même avec un id forgé") est une propriété de la REQUÊTE SQL elle-même
 * (`accessibleSessionWhere`), pas d'une vérification applicative après
 * coup — un mock ne prouverait que l'appel de méthodes, jamais que la
 * requête filtre réellement les bonnes lignes. Même dérogation déjà
 * établie pour les autres suites d'intégration de ce dépôt (voir leurs
 * commentaires de fichier).
 *
 * Nécessite `TEST_DATABASE_URL` — voir le README. Suite entièrement
 * SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[session-access.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Les garanties de contrôle d'accès (créateur/invité/non-invité, id forgé, " +
      "révocation, migration legacy) ne sont PAS validées par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("session-access (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let access: typeof import("./session-access");

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    access = await import("./session-access");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "SessionInvite", "Vote", "Proposal", "Session", "Game", "User" CASCADE`
    );
  });

  let counter = 0;
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser() {
    const id = uniq("user");
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    const community = await db.community.upsert({
      where: { slug: "default" },
      create: { slug: "default", name: "Défaut", status: "ACTIVE" },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    await db.membership.create({ data: { communityId: community.id, userId: user.id, status: "ACTIVE" } });
    return user;
  }

  async function makeSession(creatorId: string, notifiedUserIds: string[] | null = null) {
    return db.session.create({
      data: {
        date: new Date("2026-10-01T20:00:00.000Z"),
        createdById: creatorId,
        notifiedUserIds: notifiedUserIds === null ? undefined : notifiedUserIds,
      },
    });
  }

  describe("accessibleSessionWhere / getSessionAccessRole", () => {
    it("le créateur a toujours accès, même sans la moindre ligne SessionInvite", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id);

      const role = await access.getSessionAccessRole(creator.id, session.id);
      expect(role).toBe("creator");
      expect(await access.canAccessSession(creator.id, session.id)).toBe(true);
    });

    it("un invité ACTIVE a accès, rôle 'guest'", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      await db.sessionInvite.create({
        data: { sessionId: session.id, userId: guest.id, invitedById: creator.id, status: "ACTIVE" },
      });

      expect(await access.getSessionAccessRole(guest.id, session.id)).toBe("guest");
    });

    it("un utilisateur jamais invité n'a AUCUN accès, même avec un id de session réel et valide", async () => {
      const creator = await makeUser();
      const stranger = await makeUser();
      const session = await makeSession(creator.id);

      expect(await access.getSessionAccessRole(stranger.id, session.id)).toBeNull();
      expect(await access.canAccessSession(stranger.id, session.id)).toBe(false);
    });

    it("un id de session totalement forgé (inexistant) ne donne accès à personne, pas même au 'créateur' prétendu", async () => {
      const someone = await makeUser();
      expect(await access.getSessionAccessRole(someone.id, "session-id-invente-qui-nexiste-pas")).toBeNull();
    });

    it("un invité RÉVOQUÉ perd l'accès immédiatement", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      await db.sessionInvite.create({
        data: { sessionId: session.id, userId: guest.id, invitedById: creator.id, status: "REVOKED", revokedAt: new Date() },
      });

      expect(await access.getSessionAccessRole(guest.id, session.id)).toBeNull();
    });

    it("accessibleSessionWhere filtre correctement une liste — seules les soirées accessibles apparaissent, jamais un ensemble plus large", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const stranger = await makeUser();
      const ownSession = await makeSession(creator.id);
      const invitedSession = await makeSession(stranger.id);
      const privateSession = await makeSession(stranger.id);
      await db.sessionInvite.create({
        data: { sessionId: invitedSession.id, userId: creator.id, invitedById: stranger.id, status: "ACTIVE" },
      });
      void guest;

      const visible = await db.session.findMany({ where: access.accessibleSessionWhere(creator.id) });
      const visibleIds = visible.map((s) => s.id).sort();
      expect(visibleIds).toEqual([ownSession.id, invitedSession.id].sort());
      expect(visibleIds).not.toContain(privateSession.id);
    });
  });

  describe("inviteToSession / revokeSessionInvite — réservées au créateur (vérifié par l'appelant), idempotentes", () => {
    it("crée une ligne ACTIVE", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);

      const invite = await access.inviteToSession(session.id, creator.id, guest.id);
      expect(invite?.status).toBe("ACTIVE");
      expect(await access.canAccessSession(guest.id, session.id)).toBe(true);
    });

    it("jamais de ligne pour le créateur lui-même — no-op silencieux", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id);

      const invite = await access.inviteToSession(session.id, creator.id, creator.id);
      expect(invite).toBeNull();
      expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it("réinviter quelqu'un déjà ACTIVE est idempotent — une seule ligne, jamais de doublon", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);

      await access.inviteToSession(session.id, creator.id, guest.id);
      await access.inviteToSession(session.id, creator.id, guest.id);

      expect(await db.sessionInvite.count({ where: { sessionId: session.id, userId: guest.id } })).toBe(1);
    });

    it("révoquer coupe l'accès immédiatement, sans toucher aux contributions déjà écrites (Vote)", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      await access.inviteToSession(session.id, creator.id, guest.id);
      const game = await db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById: creator.id } });
      const proposal = await db.proposal.create({ data: { sessionId: session.id, gameId: game.id, proposedById: guest.id } });
      await db.vote.create({ data: { proposalId: proposal.id, userId: guest.id } });

      const revoked = await access.revokeSessionInvite(session.id, guest.id, creator.id);
      expect(revoked).toBe(true);
      expect(await access.canAccessSession(guest.id, session.id)).toBe(false);

      // Le vote reste intact — seul l'accès FUTUR est coupé, jamais les
      // contributions passées.
      const stillThere = await db.vote.findUnique({ where: { proposalId_userId: { proposalId: proposal.id, userId: guest.id } } });
      expect(stillThere).not.toBeNull();
    });

    it("révoquer deux fois est idempotent — la seconde tentative renvoie false, sans erreur", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      await access.inviteToSession(session.id, creator.id, guest.id);

      expect(await access.revokeSessionInvite(session.id, guest.id, creator.id)).toBe(true);
      expect(await access.revokeSessionInvite(session.id, guest.id, creator.id)).toBe(false);
    });

    it("réinviter après un retrait RÉUTILISE la même ligne (jamais une seconde) et redonne l'accès", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      const first = await access.inviteToSession(session.id, creator.id, guest.id);
      await access.revokeSessionInvite(session.id, guest.id, creator.id);
      expect(await access.canAccessSession(guest.id, session.id)).toBe(false);

      const second = await access.inviteToSession(session.id, creator.id, guest.id);
      expect(second?.id).toBe(first?.id);
      expect(second?.status).toBe("ACTIVE");
      expect(await access.canAccessSession(guest.id, session.id)).toBe(true);
      expect(await db.sessionInvite.count({ where: { sessionId: session.id, userId: guest.id } })).toBe(1);
    });

    it("deux révocations concurrentes du même invité : une seule compte comme ayant réellement agi, aucune erreur, état final cohérent", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeSession(creator.id);
      await access.inviteToSession(session.id, creator.id, guest.id);

      const [first, second] = await Promise.all([
        access.revokeSessionInvite(session.id, guest.id, creator.id),
        access.revokeSessionInvite(session.id, guest.id, creator.id),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(await access.canAccessSession(guest.id, session.id)).toBe(false);
    });
  });

  describe("filterByActiveSessionInvite — filtre RESTRICTIF uniquement, jamais un ajout", () => {
    it("ne garde que le créateur et les invités ACTIFS parmi les candidats", async () => {
      const creator = await makeUser();
      const activeGuest = await makeUser();
      const revokedGuest = await makeUser();
      const neverInvited = await makeUser();
      const slug = uniq("serveur");
      const community = await db.community.upsert({ where: { slug }, create: { slug, name: "Serveur", status: "ACTIVE" }, update: { status: "ACTIVE" } });
      await db.membership.createMany({ data: [creator, activeGuest, revokedGuest, neverInvited].map((user) => ({ communityId: community.id, userId: user.id, status: "ACTIVE" })) });
      const session = await db.session.create({ data: { date: new Date(), createdById: creator.id, communityId: community.id } });
      await access.inviteToSession(session.id, creator.id, activeGuest.id);
      await access.inviteToSession(session.id, creator.id, revokedGuest.id);
      await access.revokeSessionInvite(session.id, revokedGuest.id, creator.id);

      const result = await access.filterByActiveSessionInvite(session.id, creator.id, [
        creator,
        activeGuest,
        revokedGuest,
        neverInvited,
      ]);
      expect(result.map((u) => u.id).sort()).toEqual([creator.id, activeGuest.id].sort());
    });

    it("isolation OFF : une adhésion révoquée coupe les notifications même si l'invitation de session est encore active", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
      const slug = uniq("serveur");
      const community = await db.community.upsert({ where: { slug }, create: { slug, name: "Serveur", status: "ACTIVE" }, update: { status: "ACTIVE" } });
      const creator = await makeUser();
      const activeGuest = await makeUser();
      const removedGuest = await makeUser();
      await db.membership.createMany({ data: [
        { communityId: community.id, userId: creator.id, status: "ACTIVE" },
        { communityId: community.id, userId: activeGuest.id, status: "ACTIVE" },
        { communityId: community.id, userId: removedGuest.id, status: "ACTIVE" },
      ] });
      const session = await db.session.create({
        data: { date: new Date(), createdById: creator.id, communityId: community.id },
      });
      await db.sessionInvite.createMany({ data: [activeGuest, removedGuest].map((user) => ({
        sessionId: session.id, userId: user.id, invitedById: creator.id, status: "ACTIVE" as const,
      })) });
      await db.membership.update({ where: { communityId_userId: { communityId: community.id, userId: removedGuest.id } }, data: { status: "REMOVED" } });

      const result = await access.filterByActiveSessionInvite(session.id, creator.id, [creator, activeGuest, removedGuest]);

      expect(result.map((user) => user.id).sort()).toEqual([creator.id, activeGuest.id].sort());
    });
  });

  describe("migration legacy — backfill des invitations depuis notifiedUserIds (soirées existantes)", () => {
    /** Exécute EXACTEMENT le même INSERT que la migration
     * `20260921100000_add_session_invite` — lu depuis le fichier réel,
     * jamais réimplémenté ici, pour ne jamais tester une réécriture qui
     * pourrait diverger du SQL réellement appliqué en production. */
    async function runBackfillMigrationSql() {
      const sql = readFileSync(
        join(__dirname, "..", "..", "prisma", "migrations", "20260921100000_add_session_invite", "migration.sql"),
        "utf-8"
      );
      const insertStart = sql.indexOf('INSERT INTO "SessionInvite"');
      expect(insertStart).toBeGreaterThan(-1);
      const insertStatement = sql.slice(insertStart);
      await db.$executeRawUnsafe(insertStatement);
    }

    it("reprend l'invitation quand notifiedUserIds est une source fiable (tableau explicite, même non vide)", async () => {
      const creator = await makeUser();
      const guestA = await makeUser();
      const guestB = await makeUser();
      // Simule une soirée déjà en base AVANT la migration — écrite
      // directement (contourne `createSession`), comme une vraie ligne
      // historique le serait.
      const legacySession = await db.session.create({
        data: {
          date: new Date("2026-01-01T20:00:00.000Z"),
          createdById: creator.id,
          notifiedUserIds: [guestA.id, guestB.id],
        },
      });

      await runBackfillMigrationSql();

      const invites = await db.sessionInvite.findMany({ where: { sessionId: legacySession.id } });
      expect(invites.map((i) => i.userId).sort()).toEqual([guestA.id, guestB.id].sort());
      expect(invites.every((i) => i.status === "ACTIVE")).toBe(true);
      expect(invites.every((i) => i.invitedById === creator.id)).toBe(true);
    });

    it("n'invente JAMAIS une invitation depuis notifiedUserIds absent (NULL) — accès créateur seul", async () => {
      const creator = await makeUser();
      const someUser = await makeUser();
      void someUser;
      const legacySession = await db.session.create({
        data: {
          date: new Date("2026-01-01T20:00:00.000Z"),
          createdById: creator.id,
          // `notifiedUserIds` jamais posé — sessions créées avant la
          // fonctionnalité de ping sélectif elle-même.
        },
      });

      await runBackfillMigrationSql();

      expect(await db.sessionInvite.count({ where: { sessionId: legacySession.id } })).toBe(0);
      // Le créateur garde quand même accès, sans la moindre ligne.
      expect(await access.canAccessSession(creator.id, legacySession.id)).toBe(true);
    });

    it("n'invente jamais d'invitation pour un id halluciné dans notifiedUserIds (utilisateur supprimé depuis) — jamais de ligne orpheline", async () => {
      const creator = await makeUser();
      const legacySession = await db.session.create({
        data: {
          date: new Date("2026-01-01T20:00:00.000Z"),
          createdById: creator.id,
          notifiedUserIds: ["id-utilisateur-qui-nexiste-plus"],
        },
      });

      await runBackfillMigrationSql();

      expect(await db.sessionInvite.count({ where: { sessionId: legacySession.id } })).toBe(0);
    });

    it("exclut le créateur de son propre backfill même s'il apparaît dans son notifiedUserIds", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const legacySession = await db.session.create({
        data: {
          date: new Date("2026-01-01T20:00:00.000Z"),
          createdById: creator.id,
          notifiedUserIds: [creator.id, guest.id],
        },
      });

      await runBackfillMigrationSql();

      const invites = await db.sessionInvite.findMany({ where: { sessionId: legacySession.id } });
      expect(invites.map((i) => i.userId)).toEqual([guest.id]);
    });

    it("un tableau notifiedUserIds explicitement VIDE reste une source fiable — créateur seul backfillé (zéro invité, jamais 'tout le monde')", async () => {
      const creator = await makeUser();
      const legacySession = await db.session.create({
        data: {
          date: new Date("2026-01-01T20:00:00.000Z"),
          createdById: creator.id,
          notifiedUserIds: [],
        },
      });

      await runBackfillMigrationSql();

      expect(await db.sessionInvite.count({ where: { sessionId: legacySession.id } })).toBe(0);
      expect(await access.canAccessSession(creator.id, legacySession.id)).toBe(true);
    });
  });
});
