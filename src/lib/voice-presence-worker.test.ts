import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVoicePresenceWorker,
  registerVoicePresenceSessionStopper,
  voicePresenceWorkerConfig,
  withVoicePresenceSessionEnd,
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

  it("keeps a committed session stopped until it disappears from discovery", async () => {
    let targets = [target("session-active")];
    const collector = { start: vi.fn(), stop: vi.fn() };
    const createCollector = vi.fn(() => collector);
    const worker = createVoicePresenceWorker({
      loadTargets: async () => targets,
      createCollector,
      onFatal: vi.fn(),
    });

    await worker.start();
    const release = await worker.pauseSession("session-active");
    await release(true);
    await worker.refresh();
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(createCollector).toHaveBeenCalledOnce();

    targets = [];
    await worker.refresh();
    targets = [target("session-active")];
    await worker.refresh();
    expect(createCollector).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it("stops a session collector before the terminal session write and resumes it if that write fails", async () => {
    const stopSession = vi.fn<() => Promise<(committed: boolean) => Promise<void>>>(async () => async () => undefined);
    const unregister = registerVoicePresenceSessionStopper(stopSession);
    const events: string[] = [];
    stopSession.mockImplementation(async () => {
      events.push("stop");
      return async (committed: boolean) => { events.push(committed ? "keep-stopped" : "resume"); };
    });

    await expect(withVoicePresenceSessionEnd("session-active", async () => {
      events.push("write");
      throw new Error("synthetic transaction failure");
    })).rejects.toThrow("synthetic transaction failure");

    expect(events).toEqual(["stop", "write", "resume"]);
    unregister();
  });

  it("allows only one session transition coordinator per Node process", () => {
    const unregister = registerVoicePresenceSessionStopper(async () => async () => undefined);
    expect(() => registerVoicePresenceSessionStopper(async () => async () => undefined))
      .toThrow("Voice presence worker already registered in this process");
    unregister();
  });
});
