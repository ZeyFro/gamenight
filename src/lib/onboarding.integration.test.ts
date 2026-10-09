import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
const current = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: current.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));

describe.skipIf(!TEST_DATABASE_URL)("accueil : état réel, MP et concurrence Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let onboarding: typeof import("./onboarding");
  let reminders: typeof import("./onboarding-reminder");
  let actions: typeof import("../app/onboarding-actions");
  beforeAll(async () => {
    db = (await import("./prisma")).prisma as unknown as typeof db;
    onboarding = await import("./onboarding"); reminders = await import("./onboarding-reminder"); actions = await import("../app/onboarding-actions");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "NotificationEvent", "User", "Community" CASCADE');
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Discord réel interdit"); }));
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true"); vi.stubEnv("DISCORD_BOT_TOKEN", "test");
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "gamenight.test");
    await db.community.createMany({ data: [{ id: "a", slug: "default", name: "A", status: "ACTIVE" }, { id: "b", slug: "b", name: "B", status: "ACTIVE" }] });
    await db.user.createMany({ data: ["alice", "bob"].map(id => ({ id, discordId: id, discordName: id, onboardingCompleted: true })) });
    await db.membership.createMany({ data: [{ userId: "alice", communityId: "a" }, { userId: "alice", communityId: "b" }, { userId: "bob", communityId: "b" }] });
    current.user.mockResolvedValue({ id: "alice" });
  });
  async function resolve() {
    const event = await db.notificationEvent.findFirstOrThrow({ where: { eventType: onboarding.ONBOARDING_REMINDER } });
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { eventId: event.id } });
    return reminders.onboardingReminderResolver.resolve({ event, delivery: { ...delivery, targetMessage: null }, now: new Date() });
  }
  it("le flag historique guide terminé ne masque pas Steam/planning manquants", async () => {
    const progress = await onboarding.getOnboardingProgress("alice");
    expect(progress).toMatchObject({ guideCompleted: true, steamLinked: false, planningReady: false });
    expect(onboarding.missingOnboardingSteps(progress!)).toEqual(["steam", "planning"]);
  });
  it("trois connexions simultanées produisent un seul MP et aucune émission réseau", async () => {
    await Promise.all(Array.from({ length: 3 }, () => reminders.enqueueOnboardingReminder("alice")));
    expect(await db.notificationEvent.count()).toBe(1); expect(await db.notificationDelivery.count()).toBe(1);
    await db.user.update({ where: { id: "alice" }, data: { activeCommunityId: "b" } });
    await reminders.enqueueOnboardingReminder("alice"); expect(await db.notificationDelivery.count()).toBe(1);
    const result = await resolve(); expect(result.eligible).toBe(true);
    if (result.eligible) { expect(JSON.stringify(result.action)).toContain("?step=steam"); expect(JSON.stringify(result.action)).toContain("/disponibilites"); }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("les étapes terminées pendant l'attente disparaissent du MP", async () => {
    await reminders.enqueueOnboardingReminder("alice");
    await db.user.update({ where: { id: "alice" }, data: { steamId64: "76561198000000001" } });
    const result = await resolve(); expect(result.eligible).toBe(true);
    if (result.eligible) { expect(JSON.stringify(result.action)).not.toContain("?step=steam"); expect(JSON.stringify(result.action)).toContain("/disponibilites"); }
    await db.weeklyAvailability.create({ data: { userId: "alice", dayOfWeek: 1, startTime: "20:00", endTime: "23:00" } });
    expect(await resolve()).toMatchObject({ eligible: false, reason: "expired" });
  });
  it("silence ou absence de serveur actif empêche le MP sans empêcher le guide", async () => {
    await db.user.update({ where: { id: "alice" }, data: { silenceReminders: true } });
    await reminders.enqueueOnboardingReminder("alice"); expect(await db.notificationDelivery.count()).toBe(0);
    await db.user.update({ where: { id: "alice" }, data: { silenceReminders: false } });
    await db.membership.updateMany({ where: { userId: "alice" }, data: { status: "REMOVED" } });
    await reminders.enqueueOnboardingReminder("alice"); expect(await db.notificationDelivery.count()).toBe(0);
    expect(onboarding.missingOnboardingSteps((await onboarding.getOnboardingProgress("alice"))!)).toHaveLength(2);
  });
  it("revalide le silence et le retrait juste avant livraison", async () => {
    await reminders.enqueueOnboardingReminder("alice");
    await db.user.update({ where: { id: "alice" }, data: { silenceReminders: true } });
    expect(await resolve()).toMatchObject({ eligible: false, reason: "preference_declined" });
    await db.user.update({ where: { id: "alice" }, data: { silenceReminders: false } });
    await db.membership.updateMany({ where: { userId: "alice" }, data: { status: "REMOVED" } });
    expect(await resolve()).toMatchObject({ eligible: false, reason: "expired" });
  });
  it("sans Steam persiste pour le seul compte connecté ; terminer sans planning est refusé", async () => {
    expect(await actions.completeOnboardingAction()).toBe(false);
    expect(await actions.skipSteamOnboardingAction()).toBe(true);
    expect((await onboarding.getOnboardingProgress("alice"))?.steamSkipped).toBe(true);
    expect((await onboarding.getOnboardingProgress("bob"))?.steamSkipped).toBe(false);
    expect(await actions.completeOnboardingAction()).toBe(false);
    await db.weeklyAvailability.create({ data: { userId: "alice", dayOfWeek: 1, startTime: "20:00", endTime: "23:00" } });
    expect(await actions.completeOnboardingAction()).toBe(true);
  });
  it("action anonyme ou session révoquée : aucune modification", async () => {
    current.user.mockResolvedValue(null);
    expect(await actions.skipSteamOnboardingAction()).toBe(false); expect(await actions.completeOnboardingAction()).toBe(false);
    expect(await db.notificationEvent.count()).toBe(0);
  });
  it("une exception périmée n'est pas un planning renseigné", async () => {
    await db.availabilityOverride.create({ data: { userId: "alice", date: new Date("2020-01-01"), available: false } });
    expect((await onboarding.getOnboardingProgress("alice"))?.planningReady).toBe(false);
  });
});
