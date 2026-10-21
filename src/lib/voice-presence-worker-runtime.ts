import { prisma } from "@/lib/prisma";
import { createSessionVoiceCollector } from "./session-voice-collector";
import {
  createVoicePresenceWorker,
  registerVoicePresenceSessionStopper,
  type VoicePresenceWorkerConfig,
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
  const worker = createVoicePresenceWorker({
    loadTargets: async () => {
      const sessions = await prisma.session.findMany({
        where: {
          status: "SCHEDULED",
          date: { lte: new Date() },
          community: { is: {
            status: "ACTIVE",
            channelConfigs: { some: { category: "VOICE", enabled: true } },
          } },
        },
        select: {
          id: true,
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

      return sessions.flatMap(session => {
        const community = session.community;
        const guildId = community?.discordGuildId ?? (community?.slug === "default" ? process.env.DISCORD_BOT_GUILD_ID?.trim() : null);
        const channelIds = community?.channelConfigs.map(channel => channel.discordChannelId) ?? [];
        if (!community || !guildId || !channelIds.length) return [];
        return [{ sessionId: session.id, guildId, channelIds }];
      });
    },
    createCollector: (target, callbacks) => {
      const collector = createSessionVoiceCollector({
        VOICE_PRESENCE_ENABLED: "true",
        DISCORD_BOT_TOKEN: config.token,
        VOICE_PRESENCE_GUILD_ID: target.guildId,
        VOICE_PRESENCE_CHANNEL_IDS: target.channelIds.join(","),
        VOICE_PRESENCE_SESSION_ID: target.sessionId,
      }, {
        onFatal: callbacks.onFatal,
        onGap: callbacks.onGap,
        onPersistenceError: callbacks.onPersistenceError,
      });
      if (!collector) throw new Error("Voice presence collector could not be configured");
      return collector;
    },
    onGap: (_target, reason) => {
      console.warn(`[voice-presence] Gateway gap (${reason})`);
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

  let stopped = false;
  let unregisterStopper = registerVoicePresenceSessionStopper(sessionId => worker.pauseSession(sessionId));
  const shutdown = () => { void stop(); };
  processLike.once("SIGINT", shutdown);
  processLike.once("SIGTERM", shutdown);

  async function stop() {
    if (stopped) return;
    stopped = true;
    processLike.removeListener("SIGINT", shutdown);
    processLike.removeListener("SIGTERM", shutdown);
    unregisterStopper();
    unregisterStopper = () => undefined;
    await worker.stop();
  }

  try {
    await worker.start();
  } catch {
    await stop();
    throw new Error("Voice presence worker failed to start");
  }

  return { stop, refresh: worker.refresh };
}
