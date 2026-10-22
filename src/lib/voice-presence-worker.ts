export type VoicePresenceWorkerConfig = {
  token: string;
  pollIntervalMs: number;
};

export type VoicePresenceTarget = {
  sessionId: string;
  guildId: string;
  channelIds: readonly string[];
  enabled?: boolean;
  leaseOwner?: string;
  generation?: number;
};

export type VoicePresenceStopTarget = {
  sessionId: string;
  mode: "FINALIZE" | "PURGE";
  stopAt: Date | null;
};

export type VoicePresenceCollectorCallbacks = {
  onFatal: (failure: unknown) => void;
  onPersistenceError: (error: unknown) => void;
  onGap: (reason: "resume_failed" | "transport_closed" | "shutdown" | "fatal_close" | "guild_unavailable" | "guild_removed") => void;
  onGapRecovered: (at: number) => void;
};

export type VoicePresenceCollector = {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MIN_POLL_INTERVAL_MS = 5_000;

export function voicePresenceWorkerConfig(
  env: Record<string, string | undefined>,
): VoicePresenceWorkerConfig | null {
  if (env.VOICE_PRESENCE_WORKER_MODE !== "standalone") return null;
  if (env.VOICE_PRESENCE_ENABLED !== "true") return null;

  const token = env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const consentDecision = env.VOICE_PRESENCE_CONSENT_DECISION?.trim() ?? "";
  const retentionDecision = env.VOICE_PRESENCE_RETENTION_DECISION?.trim() ?? "";
  const pollRaw = env.VOICE_PRESENCE_POLL_INTERVAL_MS?.trim();
  const pollIntervalMs = pollRaw ? Number(pollRaw) : DEFAULT_POLL_INTERVAL_MS;

  if (
    !token ||
    !consentDecision ||
    !retentionDecision ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < MIN_POLL_INTERVAL_MS
  ) {
    throw new Error("Voice presence worker configuration incomplete");
  }

  return { token, pollIntervalMs };
}

type ActiveCollector = { key: string; target: VoicePresenceTarget; collector: VoicePresenceCollector };
type VoicePresenceGlobalState = { stop?: (() => Promise<void>) | null; hostOwnsSignals?: boolean };
const VOICE_PRESENCE_GLOBAL_KEY = "__gamenightVoicePresenceWorkerState" as const;
const workerGlobal = globalThis as typeof globalThis & { [VOICE_PRESENCE_GLOBAL_KEY]?: VoicePresenceGlobalState };
const globalState = workerGlobal[VOICE_PRESENCE_GLOBAL_KEY] ??= {};

export function createVoicePresenceWorker(options: {
  loadTargets: () => Promise<readonly VoicePresenceTarget[]>;
  loadStopTargets?: () => Promise<readonly VoicePresenceStopTarget[]>;
  finalizeStopTarget?: (target: VoicePresenceStopTarget) => Promise<void>;
  createCollector: (target: VoicePresenceTarget, callbacks: VoicePresenceCollectorCallbacks) => VoicePresenceCollector;
  onFatal: (failure: unknown) => void | Promise<void>;
  onGap?: (target: VoicePresenceTarget, reason: VoicePresenceCollectorCallbacks["onGap"] extends (reason: infer T) => void ? T : never) => void;
  onGapRecovered?: (target: VoicePresenceTarget, at: number) => void;
  releaseLease?: (target: VoicePresenceTarget) => void | Promise<void>;
  pollIntervalMs?: number;
}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    throw new Error("Invalid voice presence poll interval");
  }

  const collectors = new Map<string, ActiveCollector>();
  let started = false;
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let failure: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;

  async function stopCollectors() {
    const active = [...collectors.values()];
    collectors.clear();
    const results = await Promise.allSettled(active.map(({ collector }) => Promise.resolve().then(() => collector.stop())));
    await Promise.allSettled(active.map(({ target }) => Promise.resolve().then(() => options.releaseLease?.(target))));
    if (results.some(result => result.status === "rejected")) throw new Error("Voice presence collectors failed to stop");
  }

  function stop() {
    return stopping ??= (async () => {
      stopped = true;
      started = false;
      if (timer) clearInterval(timer);
      timer = null;
      await stopCollectors();
    })();
  }

  async function fail(error: unknown) {
    if (!failure) {
      failure = (async () => {
        try {
          await stop();
        } catch (stopError) {
          await options.onFatal({ kind: "shutdown", failure: error, error: stopError });
          return;
        }
        await options.onFatal(error);
      })();
    }
    await failure;
  }

  function normalizedTargets(targets: readonly VoicePresenceTarget[]) {
    const result = new Map<string, { target: VoicePresenceTarget; key: string }>();
    for (const candidate of targets) {
      const channelIds = [...new Set(candidate.channelIds)].sort();
      if (
        !candidate.sessionId ||
        !/^\d{17,20}$/.test(candidate.guildId) ||
        !channelIds.length ||
        channelIds.some(channelId => !/^\d{17,20}$/.test(channelId))
      ) {
        throw new Error("Invalid active voice presence target");
      }
      if (result.has(candidate.sessionId)) throw new Error("Duplicate active voice presence session");
      const target = { ...candidate, channelIds };
      result.set(candidate.sessionId, {
        target,
        key: JSON.stringify([target.guildId, channelIds, target.enabled !== false, target.leaseOwner ?? null, target.generation ?? null]),
      });
    }
    return result;
  }

  async function refresh() {
    if (!started || stopped || polling || failure) return;
    polling = true;
    try {
      const loadedTargets = await options.loadTargets();
      if (!started || stopped || failure) return;
      const targets = normalizedTargets(loadedTargets);
      const stopTargets = await options.loadStopTargets?.() ?? [];
      const stopBySession = new Map(stopTargets.map(target => [target.sessionId, target]));

      for (const [sessionId, active] of collectors) {
        const current = targets.get(sessionId);
        if (!current || stopBySession.has(sessionId) || current.key !== active.key || current.target.enabled === false) {
          collectors.delete(sessionId);
          await active.collector.stop();
          await options.releaseLease?.(active.target);
        }
      }

      for (const target of stopTargets) {
        if (!started || stopped || failure) break;
        await options.finalizeStopTarget?.(target);
      }

      for (const [sessionId, current] of targets) {
        if (!started || stopped || failure) break;
        if (collectors.has(sessionId) || current.target.enabled === false || stopBySession.has(sessionId)) continue;
        const callbacks: VoicePresenceCollectorCallbacks = {
          onFatal: failure => { void fail({ kind: "gateway", failure }); },
          onPersistenceError: error => { void fail({ kind: "persistence", error }); },
          onGap: reason => options.onGap?.(current.target, reason),
          onGapRecovered: at => options.onGapRecovered?.(current.target, at),
        };
        const collector = options.createCollector(current.target, callbacks);
        collectors.set(sessionId, { key: current.key, target: current.target, collector });
        await collector.start();
      }
    } catch (error) {
      await fail({ kind: "discovery", error });
      throw error;
    } finally {
      polling = false;
    }
  }

  return {
    async start() {
      if (started || stopped) return;
      started = true;
      await refresh();
      if (!stopped) {
        timer = setInterval(() => { void refresh().catch(() => undefined); }, pollIntervalMs);
      }
    },
    refresh,
    stop,
  };
}

export function isVoicePresenceShutdownManaged() {
  return globalState.hostOwnsSignals === true;
}

export function registerVoicePresenceWorkerStop(stop: () => Promise<void>) {
  if (globalState.stop) throw new Error("Voice presence worker already registered in this process");
  globalState.stop = stop;
  return () => {
    if (globalState.stop === stop) {
      globalState.stop = null;
    }
  };
}
