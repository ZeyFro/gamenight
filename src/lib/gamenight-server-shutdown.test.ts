import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runnerUrl = pathToFileURL(resolve("scripts/gamenight-server.mjs")).href;
const baseEnv = { ...process.env, VOICE_PRESENCE_WORKER_MODE: "standalone", VOICE_PRESENCE_ENABLED: "true" };

/** Lance le lanceur avec un Next synthétique dont le flush du worker est piloté par `stopBody`. */
function run(stopBody: string, after: string, env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { startGameNightServer } from ${JSON.stringify(runnerUrl)};
    await startGameNightServer({
      prepare: async () => { globalThis.__gamenightVoicePresenceWorkerState = { stop: async () => { ${stopBody} } }; },
      getRequestHandler: () => (_req, res) => res.end('ready'),
      close: async () => { console.log('next-closed'); },
    }, 0);
    ${after}
  `], { encoding: "utf8", timeout: 15_000, env: { ...baseEnv, ...env } });
}

describe("arrêt du lanceur auto-hébergé : signaux, second signal, délai maximal", () => {
  it.each(["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"])("%s déclenche un arrêt propre : flush puis code 0", signal => {
    const result = run(`console.log('flushed');`, `process.emit('${signal}', '${signal}');`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/flushed[\s\S]*next-closed/);
  });

  it("un second signal force un arrêt immédiat (code 1) sans attendre le flush bloqué", () => {
    const started = Date.now();
    const result = run(
      `await new Promise(() => {});`,
      `process.emit('SIGTERM', 'SIGTERM'); setTimeout(() => process.emit('SIGINT', 'SIGINT'), 100);`,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("second signal received");
    expect(result.stdout).not.toContain("next-closed");
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("un flush qui dépasse VOICE_WORKER_SHUTDOWN_TIMEOUT_MS est abandonné avec le code 1", () => {
    const result = run(`await new Promise(() => {});`, `process.emit('SIGTERM', 'SIGTERM');`, { VOICE_WORKER_SHUTDOWN_TIMEOUT_MS: "1000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("graceful shutdown exceeded 1000 ms");
    expect(result.stdout).not.toContain("next-closed");
  });

  it("un arrêt qui finit avant le délai ne déclenche pas le délai maximal", () => {
    const result = run(`await new Promise(resolve => setTimeout(resolve, 300));`, `process.emit('SIGTERM', 'SIGTERM');`, { VOICE_WORKER_SHUTDOWN_TIMEOUT_MS: "1000" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("borne le délai configurable et retombe sur 40 s si la valeur est invalide", async () => {
    const { shutdownTimeoutMs } = await import(/* @vite-ignore */ runnerUrl) as { shutdownTimeoutMs: (env: Record<string, string | undefined>) => number };
    expect(shutdownTimeoutMs({})).toBe(40_000);
    expect(shutdownTimeoutMs({ VOICE_WORKER_SHUTDOWN_TIMEOUT_MS: "5000" })).toBe(5_000);
    for (const bad of ["abc", "0", "999", "600001", "1.5", "-1"]) expect(shutdownTimeoutMs({ VOICE_WORKER_SHUTDOWN_TIMEOUT_MS: bad })).toBe(40_000);
  });
});
