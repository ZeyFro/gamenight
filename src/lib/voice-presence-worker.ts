export type VoicePresenceWorkerConfig = {
  token: string;
  pollIntervalMs: number;
};

export type VoicePresenceTarget = {
  sessionId: string;
  guildId: string;
  channelIds: readonly string[];
};

export type VoicePresenceCollectorCallbacks = {
  onFatal: (failure: unknown) => void;
  onPersistenceError: (error: unknown) => void;
  onGap: (reason: "resume_failed" | "shutdown" | "fatal_close") => void;
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

type ActiveCollector = { key: string; collector: VoicePresenceCollector };
type PauseSession = (sessionId: string) => Promise<(committed: boolean) => Promise<void>>;
type SessionStopper = (sessionId: string) => ReturnType<PauseSession>;
type VoicePresenceGlobalState = { sessionStopper: SessionStopper | null };
const VOICE_PRESENCE_GLOBAL_KEY = "__gamenightVoicePresenceWorkerState" as const;
const workerGlobal = globalThis as typeof globalThis & { [VOICE_PRESENCE_GLOBAL_KEY]?: VoicePresenceGlobalState };
const globalState = workerGlobal[VOICE_PRESENCE_GLOBAL_KEY] ??= { sessionStopper: null };

export function createVoicePresenceWorker(options: {
  loadTargets: () => Promise<readonly VoicePresenceTarget[]>;
  createCollector: (target: VoicePresenceTarget, callbacks: VoicePresenceCollectorCallbacks) => VoicePresenceCollector;
  onFatal: (failure: unknown) => void | Promise<void>;
  onGap?: (target: VoicePresenceTarget, reason: VoicePresenceCollectorCallbacks["onGap"] extends (reason: infer T) => void ? T : never) => void;
  pollIntervalMs?: number;
}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    throw new Error("Invalid voice presence poll interval");
  }

  const collectors = new Map<string, ActiveCollector>();
  const pausedSessions = new Set<string>();
  let started = false;
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let failure: Promise<void> | null = null;

  async function stopCollectors() {
    const active = [...collectors.values()];
    collectors.clear();
    await Promise.allSettled(active.map(({ collector }) => Promise.resolve(collector.stop())));
  }

  async function stop() {
    stopped = true;
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    await stopCollectors();
  }

  async function fail(error: unknown) {
    if (!failure) {
      failure = (async () => {
        await stop();
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
        key: JSON.stringify([target.guildId, channelIds]),
      });
    }
    return result;
  }

  async function refresh() {
    if (!started || stopped || polling || failure) return;
    polling = true;
    try {
      const targets = normalizedTargets(await options.loadTargets());

      for (const sessionId of pausedSessions) {
        if (!targets.has(sessionId)) pausedSessions.delete(sessionId);
      }

      for (const [sessionId, active] of collectors) {
        const current = targets.get(sessionId);
        if (!current || current.key !== active.key || pausedSessions.has(sessionId)) {
          collectors.delete(sessionId);
          await active.collector.stop();
        }
      }

      for (const [sessionId, current] of targets) {
        if (pausedSessions.has(sessionId) || collectors.has(sessionId)) continue;
        const callbacks: VoicePresenceCollectorCallbacks = {
          onFatal: failure => { void fail({ kind: "gateway", failure }); },
          onPersistenceError: error => { void fail({ kind: "persistence", error }); },
          onGap: reason => options.onGap?.(current.target, reason),
        };
        const collector = options.createCollector(current.target, callbacks);
        collectors.set(sessionId, { key: current.key, collector });
        await collector.start();
      }
    } catch (error) {
      await fail({ kind: "discovery", error });
      throw error;
    } finally {
      polling = false;
    }
  }

  async function pauseSession(sessionId: string) {
    pausedSessions.add(sessionId);
    const active = collectors.get(sessionId);
    if (active) {
      collectors.delete(sessionId);
      try {
        await active.collector.stop();
      } catch (error) {
        pausedSessions.delete(sessionId);
        throw error;
      }
    }
    let released = false;
    return async (committed: boolean) => {
      if (released) return;
      released = true;
      if (!committed) pausedSessions.delete(sessionId);
    };
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
    pauseSession: pauseSession as PauseSession,
  };
}

export function registerVoicePresenceSessionStopper(stopper: SessionStopper) {
  if (globalState.sessionStopper) throw new Error("Voice presence worker already registered in this process");
  globalState.sessionStopper = stopper;
  return () => {
    if (globalState.sessionStopper === stopper) globalState.sessionStopper = null;
  };
}

export async function withVoicePresenceSessionEnd<T>(
  sessionId: string,
  operation: () => Promise<T>,
  keepCollectorStopped: (result: T) => boolean = () => true,
): Promise<T> {
  const release = await globalState.sessionStopper?.(sessionId);
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    await release?.(false);
    throw error;
  }
  await release?.(keepCollectorStopped(result));
  return result;
}
