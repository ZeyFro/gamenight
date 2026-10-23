import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVoicePresenceWorker,
  voicePresenceWorkerConfig,
  type VoicePresenceTarget,
} from "./voice-presence-worker";

const enabledEnv = {
  VOICE_PRESENCE_WORKER_MODE: "standalone",
  VOICE_PRESENCE_ENABLED: "true",
  DISCORD_BOT_TOKEN: "synthetic-token",
  VOICE_PRESENCE_CONSENT_DECISION: "synthetic-consent-decision",
  VOICE_PRESENCE_RETENTION_DECISION: "synthetic-retention-decision",
};

const target = (sessionId: string, channelId = "456789012345678901"): VoicePresenceTarget => ({
  sessionId,
  guildId: "123456789012345678",
  channelIds: [channelId],
});

afterEach(() => vi.restoreAllMocks());

describe("voice presence worker (synthetic dependencies only)", () => {
  it("waits for every stop, propagates a stop failure, and reports a concurrent fatal failure only after flushing", async () => {
    let resolveFlush!: () => void;
    let callbacks!: { onPersistenceError: (error: unknown) => void };
    const onFatal = vi.fn();
    const worker = createVoicePresenceWorker({
      loadTargets: async () => [target("first"), target("second")],
      createCollector: (session, value) => {
        callbacks = value;
        return { start: vi.fn(), stop: session.sessionId === "first"
          ? () => Promise.reject(new Error("synthetic secret stop detail"))
          : () => new Promise<void>(resolve => { resolveFlush = resolve; }) };
      },
      onFatal,
    });
    await worker.start();
    let settled = false;
    const stopping = worker.stop().catch(error => { settled = true; return error; });
    await Promise.resolve();
    callbacks.onPersistenceError(new Error("synthetic fatal write failure"));
    await new Promise(resolve => setImmediate(resolve));
    expect(onFatal).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    resolveFlush();
    expect(await stopping).toEqual(new Error("Voice presence collectors failed to stop"));
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce());
  });

  it("stays off without the explicit flag and fails closed when policy decisions are missing", () => {
    expect(voicePresenceWorkerConfig({ ...enabledEnv, VOICE_PRESENCE_WORKER_MODE: "" })).toBeNull();
    expect(voicePresenceWorkerConfig({ ...enabledEnv, VOICE_PRESENCE_ENABLED: "" })).toBeNull();
    expect(voicePresenceWorkerConfig({ ...enabledEnv, VOICE_PRESENCE_ENABLED: "false" })).toBeNull();
    expect(() => voicePresenceWorkerConfig({
      VOICE_PRESENCE_WORKER_MODE: "standalone",
      VOICE_PRESENCE_ENABLED: "true",
      DISCORD_BOT_TOKEN: "synthetic-token",
    })).toThrow("Voice presence worker configuration incomplete");
  });

  it("discovers active session targets, starts their collector, and stops it when the session ends", async () => {
    let targets = [target("session-active")];
    const collector = { start: vi.fn(), stop: vi.fn() };
    const createCollector = vi.fn(() => collector);
    const worker = createVoicePresenceWorker({
      loadTargets: async () => targets,
      createCollector,
      onFatal: vi.fn(),
    });

    await worker.start();
    expect(createCollector).toHaveBeenCalledWith(target("session-active"), expect.any(Object));
    expect(collector.start).toHaveBeenCalledOnce();

    targets = [];
    await worker.refresh();
    expect(collector.stop).toHaveBeenCalledOnce();
    await worker.stop();
  });

  it("reports fatal collector errors and stops every active collector", async () => {
    let callbacks: { onFatal: (error: unknown) => void; onPersistenceError: (error: unknown) => void } | undefined;
    const collector = { start: vi.fn(), stop: vi.fn() };
    const onFatal = vi.fn();
    const worker = createVoicePresenceWorker({
      loadTargets: async () => [target("session-active")],
      createCollector: (_target, value) => { callbacks = value; return collector; },
      onFatal,
    });

    await worker.start();
    callbacks!.onPersistenceError(new Error("synthetic write failure"));
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce());
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ kind: "persistence" }));
  });

  it("surfaces target discovery failures to the host supervisor", async () => {
    const onFatal = vi.fn();
    const worker = createVoicePresenceWorker({
      loadTargets: async () => { throw new Error("synthetic database failure"); },
      createCollector: vi.fn(),
      onFatal,
    });

    await expect(worker.start()).rejects.toThrow("synthetic database failure");
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ kind: "discovery" }));
  });

  it("does not create collectors when stopped during target discovery", async () => {
    let resolveTargets!: (targets: readonly VoicePresenceTarget[]) => void;
    const loadTargets = vi.fn(() => new Promise<readonly VoicePresenceTarget[]>(resolve => { resolveTargets = resolve; }));
    const createCollector = vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }));
    const worker = createVoicePresenceWorker({ loadTargets, createCollector, onFatal: vi.fn() });

    const starting = worker.start();
    await vi.waitFor(() => expect(loadTargets).toHaveBeenCalledOnce());
    await worker.stop();
    resolveTargets([target("session-active")]);
    await starting;

    expect(createCollector).not.toHaveBeenCalled();
  });

  it("stops and releases a lease when a session disappears from discovery", async () => {
    let targets = [target("session-active")];
    const collector = { start: vi.fn(), stop: vi.fn() };
    const createCollector = vi.fn(() => collector);
    const releaseLease = vi.fn();
    const worker = createVoicePresenceWorker({
      loadTargets: async () => targets,
      createCollector,
      onFatal: vi.fn(),
      releaseLease,
    });

    await worker.start();
    targets = [];
    await worker.refresh();
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(releaseLease).toHaveBeenCalledOnce();
    expect(createCollector).toHaveBeenCalledOnce();

    targets = [target("session-active")];
    await worker.refresh();
    expect(createCollector).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it("releases the current lease before finalizing a durable stop command", async () => {
    const collector = { start: vi.fn(), stop: vi.fn() };
    const releaseLease = vi.fn();
    const finalizeStopTarget = vi.fn();
    let stopTargets: readonly { sessionId: string; mode: "FINALIZE" | "PURGE"; stopAt: Date | null }[] = [];
    const worker = createVoicePresenceWorker({
      loadTargets: async () => [{ ...target("session-active"), leaseOwner: "worker-a", generation: 4 }],
      loadStopTargets: async () => stopTargets,
      createCollector: () => collector,
      onFatal: vi.fn(),
      releaseLease,
      finalizeStopTarget,
    });
    await worker.start();
    finalizeStopTarget.mockClear();
    releaseLease.mockClear();

    // The durable stop is visible to the owner in the same poll that removes
    // the target. The worker must flush, release its fence, then finalize.
    stopTargets = [{ sessionId: "session-active", mode: "FINALIZE", stopAt: new Date() }];
    await worker.refresh();
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(releaseLease).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-active", generation: 4 }));
    expect(finalizeStopTarget).toHaveBeenCalledWith(stopTargets[0]);
    await worker.stop();
  });
});

describe("voice presence worker: base indisponible (dépendances synthétiques)", () => {
  afterEach(() => vi.useRealTimers());

  const failing = (calls: { n: number }, failFrom: number, failUntil = Infinity) => async () => {
    calls.n += 1;
    if (calls.n >= failFrom && calls.n < failUntil) throw new Error("postgresql://user:secret@127.0.0.1:1/db");
    return [] as readonly VoicePresenceTarget[];
  };

  it("fait échouer le démarrage immédiatement (pas de nouvelle tentative avant un premier succès)", async () => {
    const onFatal = vi.fn();
    const calls = { n: 0 };
    const worker = createVoicePresenceWorker({
      loadTargets: failing(calls, 1), createCollector: vi.fn(), onFatal, maxConsecutiveFailures: 8,
    });
    await expect(worker.start()).rejects.toThrow();
    expect(calls.n).toBe(1);
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ kind: "discovery" }));
  });

  it("applique un backoff exponentiel plafonné, se reconnecte sans fatal et le signale", async () => {
    vi.useFakeTimers();
    const onFatal = vi.fn();
    const onDegraded = vi.fn();
    const onRecovered = vi.fn();
    const calls = { n: 0 };
    const worker = createVoicePresenceWorker({
      loadTargets: failing(calls, 2, 8), createCollector: vi.fn(), onFatal, onDegraded, onRecovered,
      pollIntervalMs: 5_000, maxConsecutiveFailures: 10, maxBackoffMs: 20_000,
    });
    await worker.start();
    expect(calls.n).toBe(1);
    // 6 échecs (appels 2 à 7) avec attentes 5, 10, 20, 20, 20, 20 s, puis succès (appel 8).
    await vi.advanceTimersByTimeAsync(5_000 * 40);
    expect(onDegraded.mock.calls.map(([attempt, delay]) => [attempt, delay]))
      .toEqual([[1, 5_000], [2, 10_000], [3, 20_000], [4, 20_000], [5, 20_000], [6, 20_000]]);
    expect(onRecovered).toHaveBeenCalledExactlyOnceWith(6);
    expect(onFatal).not.toHaveBeenCalled();
    // pas de boucle serrée : 1 + 6 échecs + 1 succès + quelques polls ordinaires après la reprise, jamais un appel par poll pendant la panne.
    expect(calls.n).toBeLessThan(8 + 40);
    await worker.stop();
  });

  it("n'exécute aucune tentative pendant le délai de backoff", async () => {
    vi.useFakeTimers();
    const calls = { n: 0 };
    const worker = createVoicePresenceWorker({
      loadTargets: failing(calls, 2), createCollector: vi.fn(), onFatal: vi.fn(),
      pollIntervalMs: 5_000, maxConsecutiveFailures: 10, maxBackoffMs: 60_000,
    });
    await worker.start();
    await vi.advanceTimersByTimeAsync(5_000); // échec n°1, backoff 5 s
    await vi.advanceTimersByTimeAsync(5_000); // échec n°2, backoff 10 s
    const afterTwo = calls.n;
    await vi.advanceTimersByTimeAsync(5_000); // dans le délai : aucune tentative
    expect(calls.n).toBe(afterTwo);
    await worker.stop();
  });

  it("abandonne après le plafond d'échecs consécutifs avec un fatal « discovery » (code de sortie 1 côté runtime)", async () => {
    vi.useFakeTimers();
    const onFatal = vi.fn();
    const calls = { n: 0 };
    const worker = createVoicePresenceWorker({
      loadTargets: failing(calls, 2), createCollector: vi.fn(), onFatal,
      pollIntervalMs: 5_000, maxConsecutiveFailures: 3, maxBackoffMs: 10_000,
    });
    await worker.start();
    await vi.advanceTimersByTimeAsync(5_000 * 20);
    expect(onFatal).toHaveBeenCalledOnce();
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ kind: "discovery" }));
    expect(calls.n).toBe(4); // 1 succès + 3 échecs, puis plus rien
  });
});
