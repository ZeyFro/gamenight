import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { createSessionVoiceCollector } from "./session-voice-collector";
import {
  claimSessionVoicePresenceLease,
  finalizeSessionVoicePresenceCommand,
  markSessionVoicePresenceGap,
  markSessionVoicePresenceGapRecovered,
  releaseSessionVoicePresenceLease,
  validateSessionVoicePresenceLease,
} from "./voice-presence-coordination";
import {
  createVoicePresenceWorker,
  isVoicePresenceShutdownManaged,
  registerVoicePresenceWorkerStop,
  type VoicePresenceWorkerConfig,
  type VoicePresenceStopTarget,
} from "./voice-presence-worker";

type RuntimeProcess = Pick<NodeJS.Process, "once" | "removeListener">;

function failureKind(failure: unknown) {
  if (failure && typeof failure === "object" && "kind" in failure && typeof failure.kind === "string") {
    return failure.kind.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "worker";
  }
  return "worker";
}

export async function startVoicePresenceWorkerRuntime(
  config: VoicePresenceWorkerConfig,
  options: {
    processLike?: RuntimeProcess;
    onFatal?: (failure: unknown) => void | Promise<void>;
  } = {},
) {
  const processLike = options.processLike ?? process;
  const workerId = randomUUID();
  const pendingGapWrites = new Map<string, Promise<void>>();
  const enqueueGapWrite = (target: { sessionId: string; leaseOwner?: string; generation?: number }, write: (at: Date) => Promise<unknown>, at: Date) => {
    if (!target.leaseOwner || target.generation === undefined) return;
    const previous = pendingGapWrites.get(target.sessionId) ?? Promise.resolve();
    const current = previous.then(() => write(at).then(() => undefined));
    pendingGapWrites.set(target.sessionId, current);
    void current.then(
      () => { if (pendingGapWrites.get(target.sessionId) === current) pendingGapWrites.delete(target.sessionId); },
      () => {
        if (pendingGapWrites.get(target.sessionId) === current) pendingGapWrites.delete(target.sessionId);
        if (options.onFatal) {
          void Promise.resolve(options.onFatal({ kind: "gap_persistence" })).catch(() => undefined);
          return;
        }
        console.error("[voice-presence] gap state persistence failed; service will restart");
        process.exitCode = 1;
        setImmediate(() => process.exit(1));
      },
    );
  };
  const flushGapWrites = async (sessionId?: string) => {
    while (true) {
      const sessions = sessionId
        ? pendingGapWrites.has(sessionId) ? [sessionId] : []
        : [...pendingGapWrites.keys()];
      if (!sessions.length) return;
      const results = await Promise.allSettled(sessions.map(async id => {
        while (true) {
          const pending = pendingGapWrites.get(id);
          if (!pending) return;
          await pending;
          if (pendingGapWrites.get(id) === pending) pendingGapWrites.delete(id);
        }
      }));
      if (results.some(result => result.status === "rejected")) {
        throw new Error("Voice presence gap state writes failed");
      }
    }
  };
  const worker = createVoicePresenceWorker({
    loadTargets: async () => {
      const sessions = await prisma.session.findMany({
        where: {
          status: "SCHEDULED",
          date: { lte: wallClockNow() },
          community: { is: {
            status: "ACTIVE",
            channelConfigs: { some: { category: "VOICE", enabled: true } },
          } },
        },
        select: {
          id: true,
          voicePresenceConsents: { select: { id: true }, take: 1 },
          community: {
            select: {
              slug: true,
              discordGuildId: true,
              channelConfigs: {
                where: { category: "VOICE", enabled: true },
                select: { discordChannelId: true },
              },
            },
          },
        },
      });

      const targets = [];
      for (const session of sessions) {
        const community = session.community;
        const guildId = community?.discordGuildId ?? (community?.slug === "default" ? process.env.DISCORD_BOT_GUILD_ID?.trim() : null);
        const channelIds = community?.channelConfigs.map(channel => channel.discordChannelId) ?? [];
        if (!community || !guildId || !channelIds.length || !session.voicePresenceConsents.length) continue;
        const lease = await claimSessionVoicePresenceLease(session.id, workerId, wallClockNow());
        if (!lease.claimed) continue;
        targets.push({
          sessionId: session.id,
          guildId,
          channelIds,
          enabled: true,
          leaseOwner: workerId,
          generation: lease.generation,
        });
      }
      return targets;
    },
    validateTarget: target => target.leaseOwner !== undefined && target.generation !== undefined
      ? validateSessionVoicePresenceLease(target.sessionId, target.leaseOwner, target.generation, wallClockNow())
      : Promise.resolve(false),
    loadStopTargets: async () => {
      const now = wallClockNow();
      const controls = await prisma.sessionVoicePresenceControl.findMany({
        where: { status: { in: ["STOP_REQUESTED", "PURGE_REQUESTED"] } },
        select: { sessionId: true, status: true, stopAt: true, leaseOwner: true, leaseExpiresAt: true, generation: true },
      });
      const pending: VoicePresenceStopTarget[] = [];
      for (const control of controls) {
        const ownerIsLive = control.leaseOwner !== null && control.leaseExpiresAt !== null && control.leaseExpiresAt > now;
        if (ownerIsLive && control.leaseOwner !== workerId) continue;
        if (
          control.status === "STOP_REQUESTED" && control.leaseOwner !== null &&
          control.leaseExpiresAt !== null && control.leaseExpiresAt <= now
        ) {
          await markSessionVoicePresenceGap(control.sessionId, control.leaseOwner, control.generation, now);
        }
        pending.push({
          sessionId: control.sessionId,
          mode: control.status === "PURGE_REQUESTED" ? "PURGE" : "FINALIZE",
          stopAt: control.stopAt,
        });
      }
      return pending;
    },
    createCollector: (target, callbacks) => {
      const collector = createSessionVoiceCollector({
        VOICE_PRESENCE_ENABLED: "true",
        DISCORD_BOT_TOKEN: config.token,
        DISCORD_BOT_GUILD_ID: process.env.DISCORD_BOT_GUILD_ID,
        VOICE_PRESENCE_GUILD_ID: target.guildId,
        VOICE_PRESENCE_CHANNEL_IDS: target.channelIds.join(","),
        VOICE_PRESENCE_SESSION_ID: target.sessionId,
        VOICE_PRESENCE_WORKER_ID: target.leaseOwner,
        VOICE_PRESENCE_WORKER_GENERATION: String(target.generation),
      }, {
        onFatal: callbacks.onFatal,
        onGap: callbacks.onGap,
        onGapRecovered: callbacks.onGapRecovered,
        onPersistenceError: callbacks.onPersistenceError,
      });
      if (!collector) throw new Error("Voice presence collector could not be configured");
      return collector;
    },
    onGap: (target, reason) => {
      console.warn(`[voice-presence] Gateway gap (${reason})`);
      const at = wallClockNow();
      enqueueGapWrite(target, value => markSessionVoicePresenceGap(target.sessionId, target.leaseOwner!, target.generation!, value), at);
    },
    onGapRecovered: (target, at) => {
      enqueueGapWrite(
        target,
        value => markSessionVoicePresenceGapRecovered(target.sessionId, target.leaseOwner!, target.generation!, value),
        new Date(at),
      );
    },
    releaseLease: async target => {
      if (!target.leaseOwner || target.generation === undefined) return;
      await flushGapWrites(target.sessionId);
      await releaseSessionVoicePresenceLease(target.sessionId, target.leaseOwner, target.generation, wallClockNow());
    },
    finalizeStopTarget: async target => {
      await flushGapWrites(target.sessionId);
      await finalizeSessionVoicePresenceCommand(target.sessionId);
    },
    onFatal: async failure => {
      if (options.onFatal) {
        await options.onFatal(failure);
        return;
      }
      console.error(`[voice-presence] fatal worker error (${failureKind(failure)}); service will restart`);
      process.exitCode = 1;
      setImmediate(() => process.exit(1));
    },
    pollIntervalMs: config.pollIntervalMs,
  });

  let stopPromise: Promise<void> | null = null;
  const unregisterStopper = registerVoicePresenceWorkerStop(stop);
  const shutdown = () => { void stop(); };
  if (!isVoicePresenceShutdownManaged()) {
    processLike.once("SIGINT", shutdown);
    processLike.once("SIGTERM", shutdown);
  }

  function stop(): Promise<void> {
    return stopPromise ??= (async () => {
      processLike.removeListener("SIGINT", shutdown);
      processLike.removeListener("SIGTERM", shutdown);
      unregisterStopper();
      await worker.stop();
      await flushGapWrites();
    })();
  }

  try {
    await worker.start();
  } catch {
    await stop();
    throw new Error("Voice presence worker failed to start");
  }

  return { stop, refresh: worker.refresh };
}
