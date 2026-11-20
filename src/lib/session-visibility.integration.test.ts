import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Visibilité des soirées — tests d'intégration Postgres (CI uniquement, jamais en local : base partagée).
 * Garantie centrale : une soirée PRIVATE, mais aussi PUBLIC ou APPLICATION, n'ouvre AUCUN accès au contenu
 * à un non-invité ; seules les soirées PUBLIC / APPLICATION apparaissent dans la liste « ouvertes »
 * (informations minimales). L'accès ne naît que d'une invitation ACTIVE (jointure ou candidature acceptée).
 *
 * Nécessite `TEST_DATABASE_URL`. Suite entièrement SKIPPÉE si absente.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }));

if (!TEST_DATABASE_URL) {
  console.warn(
    "[session-visibility.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "La non-fuite des soirées privées/publiques/sur candidature n'est PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("visibilité des soirées (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let access: typeof import("./session-access");
  let apps: typeof import("./session-applications");
  let wall: typeof import("./wallclock");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    access = await import("./session-access");
    apps = await import("./session-applications");
    wall = await import("./wallclock");
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.stubEnv("SESSION_VISIBILITY_ENABLED", "true");
    await db.$executeRawUnsafe(
      `TRUNCATE "SessionApplication", "SessionDiscordSpace", "SessionSeat", "SessionInvite", "Vote", "Proposal", "Session", "Game", "User" CASCADE`
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let counter = 0;
  const uniq = (label: string) => `${label}-${++counter}`;

  async function defaultCommunityId() {
    const community = await db.community.upsert({
      where: { slug: "default" },
      create: { slug: "default", name: "Défaut", status: "ACTIVE" },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    return community.id;
  }

  async function makeUser(communityId?: string) {
    const id = uniq("user");
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: { communityId: communityId ?? (await defaultCommunityId()), userId: user.id, status: "ACTIVE" } });
    return user;
  }

  async function makeSession(
    creatorId: string,
    visibility: "PRIVATE" | "PUBLIC" | "APPLICATION",
    extra: Partial<import("@prisma/client").Prisma.SessionUncheckedCreateInput> = {}
  ) {
    return db.session.create({
      data: {
        date: new Date(wall.wallClockNow().getTime() + 2 * 24 * 3_600_000),
        createdById: creatorId,
        status: "VOTING",
        visibility,
        ...extra,
      },
    });
  }

  async function makeScene() {
    const creator = await makeUser();
    const stranger = await makeUser();
    const priv = await makeSession(creator.id, "PRIVATE");
    const pub = await makeSession(creator.id, "PUBLIC");
    const application = await makeSession(creator.id, "APPLICATION");
    return { creator, stranger, priv, pub, application };
  }

  describe("non-fuite", () => {
    it("aucune visibilité n'ouvre l'accès au contenu à un non-invité (liste, détail, id forgé)", async () => {
      const { stranger, priv, pub, application } = await makeScene();
      const rows = await db.session.findMany({ where: await access.accessibleSessionWhereFor(stranger.id), select: { id: true } });
      expect(rows).toEqual([]);
      for (const session of [priv, pub, application]) {
        expect(await access.getSessionAccessRole(stranger.id, session.id)).toBeNull();
        expect(await access.canAccessSession(stranger.id, session.id)).toBe(false);
      }
    });

    it("la liste « ouvertes » ne contient jamais une soirée PRIVATE", async () => {
      const { stranger, pub, application } = await makeScene();
      const ids = (await apps.listDiscoverableSessions(stranger.id)).map((session) => session.id).sort();
      expect(ids).toEqual([pub.id, application.id].sort());
    });

    it("les informations exposées sont minimales (pas d'invités, pas de contenu)", async () => {
      const { stranger } = await makeScene();
      const [first] = await apps.listDiscoverableSessions(stranger.id);
      expect(Object.keys(first).sort()).toEqual([
        "applicationStatus", "attendanceCapacity", "confirmedCount", "date", "decidedGameName", "id", "organizerName", "status", "visibility", "waitlistCount",
      ]);
    });

    it("le créateur et un invité actif ne revoient pas la soirée dans « ouvertes »", async () => {
      const { creator, stranger, pub } = await makeScene();
      expect((await apps.listDiscoverableSessions(creator.id)).map((session) => session.id)).not.toContain(pub.id);
      await apps.joinPublicSession(stranger.id, pub.id);
      expect((await apps.listDiscoverableSessions(stranger.id)).map((session) => session.id)).not.toContain(pub.id);
    });

    it("un membre d'une autre communauté ne voit rien", async () => {
      const { creator } = await makeScene();
      void creator;
      const other = await db.community.create({ data: { slug: uniq("autre"), name: "Autre", status: "ACTIVE" } });
      const outsider = await makeUser(other.id);
      expect(await apps.listDiscoverableSessions(outsider.id)).toEqual([]);
    });

    it("une soirée terminée, annulée ou passée n'est pas listée", async () => {
      const creator = await makeUser();
      const stranger = await makeUser();
      await makeSession(creator.id, "PUBLIC", { status: "DONE" });
      await makeSession(creator.id, "PUBLIC", { status: "CANCELLED" });
      await makeSession(creator.id, "PUBLIC", { date: new Date(wall.wallClockNow().getTime() - 3_600_000) });
      expect(await apps.listDiscoverableSessions(stranger.id)).toEqual([]);
    });

    it("flag éteint : liste vide et jointure refusée, même pour une soirée stockée PUBLIC", async () => {
      vi.stubEnv("SESSION_VISIBILITY_ENABLED", "");
      const { stranger, pub } = await makeScene();
      expect(await apps.listDiscoverableSessions(stranger.id)).toEqual([]);
      expect(await apps.joinPublicSession(stranger.id, pub.id)).toEqual({ ok: false, reason: "disabled" });
      expect(await access.canAccessSession(stranger.id, pub.id)).toBe(false);
    });
  });

  describe("soirée publique", () => {
    it("« Rejoindre » crée une invitation ACTIVE et ouvre l'accès", async () => {
      const { stranger, pub } = await makeScene();
      expect(await apps.joinPublicSession(stranger.id, pub.id)).toMatchObject({ ok: true });
      expect(await access.getSessionAccessRole(stranger.id, pub.id)).toBe("guest");
      const invite = await db.sessionInvite.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: pub.id, userId: stranger.id } } });
      expect(invite.status).toBe("ACTIVE");
    });

    it("refuse PRIVATE et APPLICATION, sans aucune invitation créée", async () => {
      const { stranger, priv, application } = await makeScene();
      expect(await apps.joinPublicSession(stranger.id, priv.id)).toEqual({ ok: false, reason: "not_public" });
      expect(await apps.joinPublicSession(stranger.id, application.id)).toEqual({ ok: false, reason: "not_public" });
      expect(await db.sessionInvite.count()).toBe(0);
    });

    it("refuse un non-membre de la communauté de la soirée", async () => {
      const { pub } = await makeScene();
      const other = await db.community.create({ data: { slug: uniq("autre"), name: "Autre", status: "ACTIVE" } });
      const outsider = await makeUser(other.id);
      expect(await apps.joinPublicSession(outsider.id, pub.id)).toEqual({ ok: false, reason: "not_found" });
      expect(await db.sessionInvite.count()).toBe(0);
    });

    it("un invité retiré par l'organisateur ne revient pas seul", async () => {
      const { creator, stranger, pub } = await makeScene();
      await apps.joinPublicSession(stranger.id, pub.id);
      await access.revokeSessionInvite(pub.id, stranger.id, creator.id);
      expect(await apps.joinPublicSession(stranger.id, pub.id)).toEqual({ ok: false, reason: "removed" });
      expect(await access.canAccessSession(stranger.id, pub.id)).toBe(false);
    });

    it("liste d'attente : au-delà de la capacité, « Rejoindre » place en attente (FIFO)", async () => {
      const creator = await makeUser();
      const first = await makeUser();
      const second = await makeUser();
      const session = await makeSession(creator.id, "PUBLIC", { status: "SCHEDULED", attendanceCapacity: 1 });
      expect(await apps.joinPublicSession(first.id, session.id)).toEqual({ ok: true, seat: "CONFIRMED" });
      expect(await apps.joinPublicSession(second.id, session.id)).toEqual({ ok: true, seat: "WAITLIST" });
    });
  });

  describe("soirée sur candidature", () => {
    it("une candidature n'ouvre aucun accès avant acceptation", async () => {
      const { stranger, application } = await makeScene();
      expect(await apps.applyToSession(stranger.id, application.id, "Je peux venir !")).toEqual({ ok: true });
      expect(await access.canAccessSession(stranger.id, application.id)).toBe(false);
      expect((await apps.listDiscoverableSessions(stranger.id)).find((session) => session.id === application.id)?.applicationStatus).toBe("PENDING");
    });

    it("refuse la candidature sur PUBLIC et PRIVATE", async () => {
      const { stranger, pub, priv } = await makeScene();
      expect(await apps.applyToSession(stranger.id, pub.id, "")).toEqual({ ok: false, reason: "not_application" });
      expect(await apps.applyToSession(stranger.id, priv.id, "")).toEqual({ ok: false, reason: "not_application" });
      expect(await db.sessionApplication.count()).toBe(0);
    });

    it("le créateur accepte : invitation ACTIVE, accès ouvert", async () => {
      const { creator, stranger, application } = await makeScene();
      await apps.applyToSession(stranger.id, application.id, "");
      const row = await db.sessionApplication.findFirstOrThrow({ where: { sessionId: application.id } });
      expect(await apps.decideSessionApplication(creator.id, row.id, "ACCEPT")).toEqual({ ok: true });
      expect(await access.getSessionAccessRole(stranger.id, application.id)).toBe("guest");
      expect((await db.sessionApplication.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("ACCEPTED");
    });

    it("un refus n'ouvre aucun accès et ne se rouvre pas", async () => {
      const { creator, stranger, application } = await makeScene();
      await apps.applyToSession(stranger.id, application.id, "");
      const row = await db.sessionApplication.findFirstOrThrow({ where: { sessionId: application.id } });
      expect(await apps.decideSessionApplication(creator.id, row.id, "DECLINE")).toEqual({ ok: true });
      expect(await access.canAccessSession(stranger.id, application.id)).toBe(false);
      expect(await apps.applyToSession(stranger.id, application.id, "")).toEqual({ ok: false, reason: "declined" });
    });

    it("ni le candidat ni un tiers ne peuvent décider ; une décision n'est prise qu'une fois", async () => {
      const { creator, stranger, application } = await makeScene();
      const third = await makeUser();
      await apps.applyToSession(stranger.id, application.id, "");
      const row = await db.sessionApplication.findFirstOrThrow({ where: { sessionId: application.id } });
      expect(await apps.decideSessionApplication(stranger.id, row.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
      expect(await apps.decideSessionApplication(third.id, row.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
      expect(await access.canAccessSession(stranger.id, application.id)).toBe(false);
      expect(await apps.decideSessionApplication(creator.id, row.id, "ACCEPT")).toEqual({ ok: true });
      expect(await apps.decideSessionApplication(creator.id, row.id, "DECLINE")).toEqual({ ok: false, reason: "not_pending" });
    });

    it("le candidat peut retirer sa candidature en attente", async () => {
      const { stranger, application } = await makeScene();
      await apps.applyToSession(stranger.id, application.id, "");
      expect(await apps.withdrawApplication(stranger.id, application.id)).toBe(true);
      expect(await apps.withdrawApplication(stranger.id, application.id)).toBe(false);
    });
  });

  describe("coorganisateur", () => {
    it("n'est désigné que par le créateur, parmi les invités actifs", async () => {
      const { creator, stranger, pub } = await makeScene();
      const invited = await makeUser();
      expect(await apps.setSessionCoOrganizer(creator.id, pub.id, invited.id)).toEqual({ ok: false, reason: "invalid" });
      await apps.joinPublicSession(invited.id, pub.id);
      expect(await apps.setSessionCoOrganizer(stranger.id, pub.id, invited.id)).toEqual({ ok: false, reason: "not_found" });
      expect(await apps.setSessionCoOrganizer(invited.id, pub.id, invited.id)).toEqual({ ok: false, reason: "forbidden" });
      expect(await apps.setSessionCoOrganizer(creator.id, pub.id, invited.id)).toEqual({ ok: true });
      expect((await db.session.findUniqueOrThrow({ where: { id: pub.id } })).coOrganizerId).toBe(invited.id);
    });

    it("le coorganisateur accepte une candidature ; un invité simple ne le peut pas", async () => {
      const { creator, stranger, application } = await makeScene();
      const co = await makeUser();
      const plainGuest = await makeUser();
      await access.inviteToSession(application.id, creator.id, co.id);
      await access.inviteToSession(application.id, creator.id, plainGuest.id);
      await apps.setSessionVisibility(creator.id, application.id, "APPLICATION");
      expect(await apps.setSessionCoOrganizer(creator.id, application.id, co.id)).toEqual({ ok: true });
      await apps.applyToSession(stranger.id, application.id, "");
      const row = await db.sessionApplication.findFirstOrThrow({ where: { sessionId: application.id } });
      expect(await apps.decideSessionApplication(plainGuest.id, row.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
      expect(await apps.decideSessionApplication(co.id, row.id, "ACCEPT")).toEqual({ ok: true });
      expect(await access.canAccessSession(stranger.id, application.id)).toBe(true);
    });

    it("flag éteint : le coorganisateur perd tout pouvoir", async () => {
      const { creator, application } = await makeScene();
      const co = await makeUser();
      await access.inviteToSession(application.id, creator.id, co.id);
      await db.session.update({ where: { id: application.id }, data: { coOrganizerId: co.id } });
      vi.stubEnv("SESSION_VISIBILITY_ENABLED", "");
      const { canManageSession } = await import("./session-visibility");
      expect(canManageSession(co.id, { createdById: creator.id, coOrganizerId: co.id })).toBe(false);
    });
  });

  describe("changement de visibilité", () => {
    it("seul le créateur change la visibilité, et jamais celle d'une soirée terminée", async () => {
      const { creator, stranger, priv } = await makeScene();
      expect(await apps.setSessionVisibility(stranger.id, priv.id, "PUBLIC")).toEqual({ ok: false, reason: "not_found" });
      expect(await apps.setSessionVisibility(creator.id, priv.id, "PUBLIC")).toEqual({ ok: true });
      expect((await apps.listDiscoverableSessions(stranger.id)).map((session) => session.id)).toContain(priv.id);
      expect(await apps.setSessionVisibility(creator.id, priv.id, "PRIVATE")).toEqual({ ok: true });
      expect((await apps.listDiscoverableSessions(stranger.id)).map((session) => session.id)).not.toContain(priv.id);
      await db.session.update({ where: { id: priv.id }, data: { status: "DONE" } });
      expect(await apps.setSessionVisibility(creator.id, priv.id, "PUBLIC")).toEqual({ ok: false, reason: "invalid" });
    });

    it("une valeur inconnue retombe sur PRIVATE", async () => {
      const { creator, pub } = await makeScene();
      expect(await apps.setSessionVisibility(creator.id, pub.id, "n'importe quoi")).toEqual({ ok: true });
      expect((await db.session.findUniqueOrThrow({ where: { id: pub.id } })).visibility).toBe("PRIVATE");
    });
  });
});
