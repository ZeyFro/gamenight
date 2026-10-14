import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cron `reminders` — les rappels partent aussi PENDANT le vote (chemin bot),
 * à leur heure réelle ; un délai déjà dépassé à la création est supprimé sans
 * envoi ; une soirée annulée n'envoie rien. Postgres isolé
 * (`TEST_DATABASE_URL`), aucun appel Discord (le chemin bot ne fait que
 * mettre en file une livraison ; l'executor est éteint). Horloge : seul `Date`
 * est simulé ; la soirée est à 20:00 heure de Paris (été : UTC+2 → 18:00 UTC).
 * Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Points d'injection : écriture concurrente pendant l'enqueue, et échec forcé
// de l'écriture de `remindersSent` pour une session donnée.
const hooks = vi.hoisted(() => ({
  onEnqueue: null as null | ((sessionId: string) => Promise<void>),
  failWriteFor: null as null | string,
}));

vi.mock("@/lib/session-announce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-announce")>();
  return {
    ...actual,
    enqueueSessionReminderDelivery: async (sessionId: string, minutes: number) => {
      await hooks.onEnqueue?.(sessionId);
      return actual.enqueueSessionReminderDelivery(sessionId, minutes);
    },
  };
});

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  const real = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  type Method = (args: { where: { id?: string } }) => unknown;
  const session = new Proxy(real.session, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (key === "update" || key === "updateMany") {
        return (args: { where: { id?: string } }) => {
          if (hooks.failWriteFor && args.where.id === hooks.failWriteFor) throw new Error("écriture forcée en échec");
          return (value as Method).call(target, args);
        };
      }
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  const prisma = new Proxy(real, {
    get(target, key) {
      if (key === "session") return session;
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  return { prisma };
});

if (!TEST_DATABASE_URL) {
  console.warn("[reminders route.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

// Soirée à 20:00 (horloge murale). Créée à 06:00 UTC = 08:00 murale.
const PARTY = new Date("2026-06-15T20:00:00.000Z");
const CREATED_AT_UTC = new Date("2026-06-15T06:00:00.000Z");

describe.skipIf(!TEST_DATABASE_URL)("GET /api/cron/reminders (Postgres isolé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let route: typeof import("./route");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    route = await import("./route");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "User", "NotificationEvent" CASCADE`);
    await db.$executeRawUnsafe(
      `INSERT INTO "CronLock" (name) VALUES ('reminders') ON CONFLICT (name) DO UPDATE SET "lockedAt" = NULL, "token" = NULL`
    );
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    hooks.onEnqueue = null;
    hooks.failWriteFor = null;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** Heure RÉELLE (UTC) correspondant à une heure murale de Paris en été le 15 juin. */
  function setParisTime(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, h - 2, m)));
  }

  async function call() {
    const response = await route.GET(new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer s3cret" } }));
    return (await response.json()) as { checked: number; sent: string[]; failed: string[]; staleSkipped: string[] };
  }

  async function makeSession(overrides: Partial<{
    status: "VOTING" | "SCHEDULED" | "CANCELLED";
    announceViaBot: boolean;
    timings: number[];
    decided: boolean;
  }> = {}) {
    const user = await db.user.create({ data: { discordId: `u-${Math.random()}`, discordName: "creator" } });
    const game = overrides.decided ? await db.game.create({ data: { name: `g-${Math.random()}`, source: "MANUAL", addedById: user.id } }) : null;
    return db.session.create({
      data: {
        date: PARTY,
        votingDeadline: new Date("2026-06-15T19:59:00.000Z"),
        createdAt: CREATED_AT_UTC,
        status: overrides.status ?? "VOTING",
        createdById: user.id,
        announceViaBot: overrides.announceViaBot ?? true,
        reminderTimings: overrides.timings ?? [900, 60],
        decidedGameId: game?.id ?? null,
        decidedTime: game ? PARTY : null,
      },
    });
  }

  async function reminderEvents(sessionId: string) {
    return db.notificationEvent.findMany({ where: { sourceId: sessionId, eventType: "SESSION_REMINDER" }, include: { deliveries: true } });
  }

  async function remindersSent(sessionId: string) {
    return (await db.session.findUniqueOrThrow({ where: { id: sessionId } })).remindersSent as string[];
  }

  it("VOTING + délai long : « 15h avant » (échéance avant la création) est supprimé sans envoi ni livraison", async () => {
    const session = await makeSession();
    setParisTime("09:00");
    const result = await call();
    expect(result.sent).toEqual([]);
    expect(result.staleSkipped).toEqual([`${session.id}:900min`]);
    expect(await reminderEvents(session.id)).toHaveLength(0);
    expect(await remindersSent(session.id)).toEqual(["900"]);
  });

  it("création lue en horloge murale : échéance 07:40 (entre 06:00 UTC et 08:00 murale) = avant la création, donc supprimée", async () => {
    // Soirée 20:00 murale, créée à 08:00 murale (06:00 UTC). « 12h20 avant » = 07:40 murale, soit 20 min
    // AVANT la création : sans conversion UTC → murale, 07:40 serait jugé APRÈS 06:00 et le rappel partirait.
    const session = await makeSession({ timings: [740] });
    setParisTime("09:00");
    const result = await call();
    expect(result.sent).toEqual([]);
    expect(result.staleSkipped).toEqual([`${session.id}:740min`]);
    expect(await reminderEvents(session.id)).toHaveLength(0);
  });

  it("VOTING : « 1h avant » part à son heure (19:00), une seule livraison PENDING, jamais en double au passage suivant", async () => {
    const session = await makeSession();
    setParisTime("09:00");
    await call();
    setParisTime("19:00");
    const result = await call();
    expect(result.sent).toEqual([`${session.id}:60min`]);
    const events = await reminderEvents(session.id);
    expect(events).toHaveLength(1);
    expect(events[0].occurrence).toBe("60");
    expect(events[0].deliveries.map((d) => d.status)).toEqual(["PENDING"]);
    expect((await remindersSent(session.id)).sort()).toEqual(["60", "900"]);

    setParisTime("19:05");
    const again = await call();
    expect(again.sent).toEqual([]);
    expect(await reminderEvents(session.id)).toHaveLength(1);
  });

  it("vote clos juste avant la soirée : la soirée devient SCHEDULED, aucun rappel déjà envoyé ne repart", async () => {
    const session = await makeSession({ timings: [60, 15] });
    setParisTime("19:00");
    await call(); // « 1h avant » pendant le vote
    expect(await reminderEvents(session.id)).toHaveLength(1);

    const game = await db.game.create({ data: { name: "g", source: "MANUAL", addedById: session.createdById } });
    await db.session.update({ where: { id: session.id }, data: { status: "SCHEDULED", decidedGameId: game.id, decidedTime: PARTY } });
    setParisTime("19:59");
    const result = await call();
    // Seul « 15 min avant » restait dû (avec le temps réel : 1 min) ; « 1h » ne repart pas.
    expect(result.sent).toEqual([`${session.id}:15min`]);
    const events = await reminderEvents(session.id);
    expect(events.map((e) => e.occurrence).sort()).toEqual(["15", "60"]);
  });

  it("soirée annulée : rien n'est envoyé ni mis en file", async () => {
    const session = await makeSession({ status: "CANCELLED" });
    setParisTime("19:00");
    const result = await call();
    expect(result.checked).toBe(0);
    expect(await reminderEvents(session.id)).toHaveLength(0);
    expect(await remindersSent(session.id)).toEqual([]);
  });

  it("VOTING sans chemin bot (webhook) : ignorée, comme avant", async () => {
    const session = await makeSession({ announceViaBot: false });
    setParisTime("19:00");
    const result = await call();
    expect(result.checked).toBe(0);
    expect(await reminderEvents(session.id)).toHaveLength(0);
  });

  it("rejouer l'enqueue du même rappel ne crée ni 2e événement ni 2e livraison", async () => {
    const session = await makeSession({ timings: [60] });
    const { enqueueSessionReminderDelivery } = await import("@/lib/session-announce");
    await enqueueSessionReminderDelivery(session.id, 60);
    await enqueueSessionReminderDelivery(session.id, 60);
    const events = await reminderEvents(session.id);
    expect(events).toHaveLength(1);
    expect(events[0].deliveries).toHaveLength(1);
  });

  it("écriture concurrente de remindersSent pendant le passage : non écrasée (fusion)", async () => {
    const session = await makeSession({ timings: [60] });
    hooks.onEnqueue = async (id) => {
      await db.session.update({ where: { id }, data: { remindersSent: ["999"] } });
    };
    setParisTime("19:00");
    await call();
    expect((await remindersSent(session.id)).sort()).toEqual(["60", "999"]);
  });

  it("échec d'écriture de remindersSent sur une session : les suivantes sont traitées, ré-enqueue sans doublon", async () => {
    const a = await makeSession({ timings: [60] });
    const b = await makeSession({ timings: [60] });
    let first: string | null = null;
    hooks.onEnqueue = async (id) => {
      first ??= id;
      hooks.failWriteFor = first;
    };
    setParisTime("19:00");
    const result = await call();
    const failedId = first as unknown as string;
    const otherId = failedId === a.id ? b.id : a.id;
    expect(await remindersSent(otherId)).toEqual(["60"]);
    expect(result.sent).toContain(`${otherId}:60min`);
    expect(await remindersSent(failedId)).toEqual([]);

    hooks.failWriteFor = null;
    hooks.onEnqueue = null;
    setParisTime("19:05");
    await call();
    expect(await remindersSent(failedId)).toEqual(["60"]);
    expect(await reminderEvents(failedId)).toHaveLength(1);
  });

  it("non-régression : SCHEDULED avec jeu décidé envoie toujours son rappel", async () => {
    const session = await makeSession({ status: "SCHEDULED", decided: true, timings: [60] });
    setParisTime("19:00");
    const result = await call();
    expect(result.sent).toEqual([`${session.id}:60min`]);
    expect(await reminderEvents(session.id)).toHaveLength(1);
  });
});
