import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startWorker = vi.hoisted(() => vi.fn());
vi.mock("./lib/voice-presence-worker-runtime", () => ({ startVoicePresenceWorkerRuntime: startWorker }));

import { register } from "./instrumentation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VOICE_PRESENCE_WORKER_MODE", "");
  vi.stubEnv("VOICE_PRESENCE_ENABLED", "");
  vi.stubEnv("DISCORD_BOT_TOKEN", "");
  vi.stubEnv("VOICE_PRESENCE_CONSENT_DECISION", "");
  vi.stubEnv("VOICE_PRESENCE_RETENTION_DECISION", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Next instrumentation voice worker gate", () => {
  it("does not import or start the runtime while collection is disabled", async () => {
    await register();
    expect(startWorker).not.toHaveBeenCalled();
  });

  it("does not start a worker from a normal self-hosted web instance", async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("VOICE_PRESENCE_CONSENT_DECISION", "synthetic-consent-decision");
    vi.stubEnv("VOICE_PRESENCE_RETENTION_DECISION", "synthetic-retention-decision");

    await register();

    expect(startWorker).not.toHaveBeenCalled();
  });

  it("refuses startup before loading runtime when policy decisions are missing", async () => {
    vi.stubEnv("VOICE_PRESENCE_WORKER_MODE", "standalone");
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "synthetic-token");

    await expect(register()).rejects.toThrow("Voice presence worker configuration incomplete");
    expect(startWorker).not.toHaveBeenCalled();
  });

  it("starts the worker only in self-hosted Node after the decision gates are set", async () => {
    vi.stubEnv("VOICE_PRESENCE_WORKER_MODE", "standalone");
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("VOICE_PRESENCE_CONSENT_DECISION", "synthetic-consent-decision");
    vi.stubEnv("VOICE_PRESENCE_RETENTION_DECISION", "synthetic-retention-decision");

    await register();

    expect(startWorker).toHaveBeenCalledWith({ token: "synthetic-token", pollIntervalMs: 15_000 });
  });

  it("never starts the worker from a Vercel instance", async () => {
    vi.stubEnv("VOICE_PRESENCE_WORKER_MODE", "standalone");
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("VOICE_PRESENCE_CONSENT_DECISION", "synthetic-consent-decision");
    vi.stubEnv("VOICE_PRESENCE_RETENTION_DECISION", "synthetic-retention-decision");
    vi.stubEnv("VERCEL", "1");

    await register();

    expect(startWorker).not.toHaveBeenCalled();
  });

  it("garde l'import du runtime derrière une condition positive NEXT_RUNTIME (bundle Edge de next dev --webpack)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/instrumentation.ts", "utf8");
    const guard = source.indexOf('process.env.NEXT_RUNTIME === "nodejs"');
    expect(guard).toBeGreaterThan(-1);
    expect(source.indexOf('import("./lib/voice-presence-worker-runtime")')).toBeGreaterThan(guard);
    expect(source).not.toMatch(/^import .*voice-presence-worker-runtime/m);
  });
});
