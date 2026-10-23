import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tout est éteint par défaut : absent, vide ou toute valeur autre que la chaîne
 * exacte `true` (« TRUE », « 1 », « yes », « true » avec espace) laisse chaque
 * fonction Discord éteinte. Aucun accès base ni réseau (modules mockés).
 */
const mocks = vi.hoisted(() => ({
  runExecutorBatch: vi.fn(),
  runCleanup: vi.fn(),
  enqueue: vi.fn(),
  after: vi.fn(),
  findMany: vi.fn(),
  offers: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findMany: mocks.findMany } } }));
vi.mock("@/lib/notification-executor", () => ({ runExecutorBatch: mocks.runExecutorBatch }));
vi.mock("@/lib/notification-dispatch", () => ({ DISPATCH_RESOLVER: {} }));
vi.mock("@/lib/discord-thread-cleanup", () => ({ runDiscordThreadCleanup: mocks.runCleanup }));
vi.mock("@/lib/gamerpower-free-games", () => ({ listAutomaticFreeGameOffers: mocks.offers }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.enqueue, enqueueDelivery: mocks.enqueue }));

import {
  isInstantSessionInviteViaBotEnabled, isRouletteDirectMessageEnabled, isSessionAnnounceViaBotEnabled,
  isSessionDirectMessageEnabled, isTournamentAnnounceViaBotEnabled, isTournamentDirectMessageEnabled,
} from "./discord-bot-config";
import { kickNotificationExecutor } from "./notification-executor-kick";
import { enqueueFreeGameAnnouncements } from "./free-game-discord";
import { GET as executorGet } from "@/app/api/cron/notification-executor/route";
import { GET as freeGameGet } from "@/app/api/cron/free-game-discord/route";
import { GET as cleanupGet } from "@/app/api/cron/discord-thread-cleanup/route";

const NOT_TRUE = [undefined, "", "false", "TRUE", "True", "1", "yes", "on", " true", "true "];
const stub = (name: string, value: string | undefined) => vi.stubEnv(name, value as string);
const authed = () => new Request("http://x/api/cron", { headers: { Authorization: "Bearer s3cret" } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("DISCORD_BOT_GUILD_ID", "111111111111111111");
  vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "222222222222222222");
  vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "333333333333333333");
  vi.stubEnv("DISCORD_BOT_TOKEN", "t");
});
afterEach(() => vi.unstubAllEnvs());

describe("drapeaux Discord : seule la valeur exacte `true` allume", () => {
  const gates: Array<[string, () => boolean]> = [
    ["DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", isSessionAnnounceViaBotEnabled],
    ["DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", isTournamentAnnounceViaBotEnabled],
    ["DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", isInstantSessionInviteViaBotEnabled],
    ["DISCORD_DM_SESSION_ENABLED", isSessionDirectMessageEnabled],
    ["DISCORD_DM_TOURNAMENT_ENABLED", isTournamentDirectMessageEnabled],
    ["DISCORD_DM_ROULETTE_ENABLED", isRouletteDirectMessageEnabled],
  ];
  it.each(gates)("%s", (name, gate) => {
    for (const value of NOT_TRUE) { stub(name, value); expect(gate(), String(value)).toBe(false); }
    stub(name, "true");
    expect(gate()).toBe(true);
  });

  it("NOTIFICATION_EXECUTOR_ENABLED : ni kick ni route cron ne traitent hors `true`", async () => {
    for (const value of NOT_TRUE) {
      stub("NOTIFICATION_EXECUTOR_ENABLED", value);
      kickNotificationExecutor();
      const res = await executorGet(authed());
      expect(await res.json()).toEqual({ enabled: false, processed: 0 });
    }
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runExecutorBatch).not.toHaveBeenCalled();
  });

  it("DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED : route cron muette hors `true`", async () => {
    for (const value of NOT_TRUE) {
      stub("DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", value);
      expect(await (await freeGameGet(authed())).json()).toEqual({ enabled: false, enqueued: 0 });
    }
  });

  it.each(["FREE_GAME_FEED_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"])(
    "producteur jeux gratuits : %s hors `true` ne lit ni la source ni la base", async (flag) => {
      for (const name of ["FREE_GAME_FEED_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"]) vi.stubEnv(name, "true");
      for (const value of NOT_TRUE) {
        stub(flag, value);
        await expect(enqueueFreeGameAnnouncements()).resolves.toEqual({ communities: 0, offers: 0, enqueued: 0 });
      }
      expect(mocks.offers).not.toHaveBeenCalled();
      expect(mocks.findMany).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

  it("DISCORD_THREAD_CLEANUP_ENABLED : rien n'est lu hors `true` ; MODE autre que `execute` = dry-run", async () => {
    for (const value of NOT_TRUE) {
      stub("DISCORD_THREAD_CLEANUP_ENABLED", value);
      expect(await (await cleanupGet(authed())).json()).toEqual({ enabled: false, dryRun: true, report: null });
    }
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("routes cron : sans CRON_SECRET 503, mauvais jeton 401, jamais de traitement", async () => {
    stub("CRON_SECRET", undefined);
    stub("NOTIFICATION_EXECUTOR_ENABLED", "true");
    expect((await executorGet(authed())).status).toBe(503);
    stub("CRON_SECRET", "s3cret");
    expect((await executorGet(new Request("http://x", { headers: { Authorization: "Bearer nope" } }))).status).toBe(401);
    expect((await freeGameGet(new Request("http://x"))).status).toBe(401);
    expect(mocks.runExecutorBatch).not.toHaveBeenCalled();
  });
});
