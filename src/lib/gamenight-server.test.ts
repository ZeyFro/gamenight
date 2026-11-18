import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runnerUrl = pathToFileURL(resolve("scripts/gamenight-server.mjs")).href;

describe("self-hosted server shutdown (synthetic Next and worker, real local HTTP)", () => {
  it.each(["prepare", "request"])("flushes in parallel with in-flight %s and closes Next only after both", phase => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { startGameNightServer } from ${JSON.stringify(runnerUrl)};
      const phase = ${JSON.stringify(phase)};
      let workComplete = false;
      let flushed = false;
      const finishWork = async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 40));
        workComplete = true;
        console.log('work-complete');
      };
      const app = {
        prepare: async () => {
          assert.equal(globalThis.__gamenightVoicePresenceWorkerState.hostOwnsSignals, true);
          globalThis.__gamenightVoicePresenceWorkerState.stop = async () => {
            console.log('flush-started');
            await new Promise(resolve => setTimeout(resolve, 40));
            flushed = true;
            console.log('flush-complete');
          };
          if (phase === 'prepare') await finishWork();
        },
        getRequestHandler: () => async (_req, res) => { await finishWork(); res.end('finished'); },
        close: async () => { assert.ok(flushed); console.log('next-closed'); },
      };
      const server = await startGameNightServer(app, 0);
      if (phase === 'prepare') assert.equal(server.listening, false);
      else assert.equal(await (await fetch('http://127.0.0.1:' + server.address().port, { headers: { connection: 'close' } })).text(), 'finished');
    `], { encoding: "utf8", timeout: 10_000, env: { ...process.env, VOICE_PRESENCE_WORKER_MODE: "standalone", VOICE_PRESENCE_ENABLED: "true" } });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/work-complete[^]*next-closed/);
    expect(result.stdout).toMatch(/flush-started[^]*flush-complete[^]*next-closed/);
  });

  it.each([0, 7])("serves HTTP and waits for persistence before closing Next with exit code %i", exitCode => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { startGameNightServer } from ${JSON.stringify(runnerUrl)};
      const require = createRequire(${JSON.stringify(runnerUrl)});
      let flushed = false;
      const routerPath = require.resolve('next/dist/server/lib/router-server');
      require.cache[routerPath] = { id: routerPath, filename: routerPath, loaded: true, exports: {
        initialize: async () => {
          globalThis.__gamenightVoicePresenceWorkerState = {
            stop: async () => {
              console.log('flush-started');
              await new Promise(resolve => setTimeout(resolve, 80));
              flushed = true;
              console.log('flush-complete');
            },
          };
          return {
            requestHandler: (_req, res) => res.end('ready'),
            upgradeHandler: () => {},
            server: {
              getUpgradeHandler: () => () => {},
              close: async () => { assert.ok(flushed); console.log('next-closed'); },
            },
            distDir: '.next',
          };
        },
      }};
      const next = require('next');
      const app = next({ dev: false, hostname: '127.0.0.1', port: 3000 });
      const server = await startGameNightServer(app, 0);
      const url = 'http://127.0.0.1:' + server.address().port;
      assert.equal(await (await fetch(url)).text(), 'ready');
      process.exitCode = ${exitCode};
      process.emit('SIGTERM', 'SIGTERM');
      await assert.rejects(fetch(url));
      console.log('admissions-closed');
    `], { encoding: "utf8", timeout: 10_000, env: { ...process.env, VOICE_PRESENCE_WORKER_MODE: "standalone", VOICE_PRESENCE_ENABLED: "true" } });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(exitCode);
    expect(result.stdout).toMatch(/flush-started[\s\S]*admissions-closed[\s\S]*flush-complete[\s\S]*next-closed/);
  });

  it("exits with failure when voice persistence cannot flush", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { startGameNightServer } from ${JSON.stringify(runnerUrl)};
      const server = await startGameNightServer({
        prepare: async () => {
          globalThis.__gamenightVoicePresenceWorkerState = { stop: async () => { throw new Error('synthetic persistence failure'); } };
        },
        getRequestHandler: () => (_req, res) => res.end('ready'),
        close: async () => {},
      }, 0);
      process.emit('SIGTERM', 'SIGTERM');
    `], { encoding: "utf8", timeout: 10_000, env: { ...process.env, VOICE_PRESENCE_WORKER_MODE: "standalone", VOICE_PRESENCE_ENABLED: "true" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[gamenight] graceful shutdown failed");
    expect(result.stderr).not.toContain("synthetic persistence failure");
  });

  it("fails closed if standalone collection is enabled but instrumentation did not register its worker", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { startGameNightServer } from ${JSON.stringify(runnerUrl)};
      await startGameNightServer({ prepare: async () => {}, getRequestHandler: () => () => {}, getUpgradeHandler: () => () => {} }, 0);
    `], { encoding: "utf8", timeout: 10_000, env: { ...process.env, VOICE_PRESENCE_WORKER_MODE: "standalone", VOICE_PRESENCE_ENABLED: "true" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Voice presence worker did not register");
  });
});
