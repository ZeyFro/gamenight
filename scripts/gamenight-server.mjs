import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 40_000;

// Délai maximal d'arrêt propre (VOICE_WORKER_SHUTDOWN_TIMEOUT_MS), borné à 1 s - 10 min ; valeur invalide = défaut.
// Le défaut reste sous TimeoutStopSec=45s (systemd) et stop_grace_period 45s (compose).
export function shutdownTimeoutMs(env = process.env) {
  const raw = env.VOICE_WORKER_SHUTDOWN_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : DEFAULT_SHUTDOWN_TIMEOUT_MS;
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 600_000 ? value : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

// SIGBREAK = Ctrl+Break Windows ; SIGHUP = fermeture de la console Windows / du terminal.
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];

export async function startGameNightServer(app, port = 3000) {
  const workerState = globalThis.__gamenightVoicePresenceWorkerState ??= { sessionStopper: null };
  workerState.hostOwnsSignals = true;
  const server = createServer(app.getRequestHandler());
  let stopWorker;
  let stopping;
  const preparing = Promise.resolve().then(() => app.prepare());

  const shutdown = () => {
    if (stopping) {
      console.error("[gamenight] second signal received; forcing immediate exit");
      process.exit(1);
    }
    const timeoutMs = shutdownTimeoutMs();
    setTimeout(() => {
      console.error(`[gamenight] graceful shutdown exceeded ${timeoutMs} ms; forcing exit`);
      process.exit(1);
    }, timeoutMs);
    stopping = (async () => {
      try {
        await preparing;
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await stopWorker?.();
        await app.close();
        process.exit(process.exitCode || 0);
      } catch {
        console.error("[gamenight] graceful shutdown failed");
        process.exit(1);
      }
    })();
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, shutdown);

  await preparing;
  // Capture before signal handlers unregister the shared runtime during its flush.
  stopWorker = globalThis.__gamenightVoicePresenceWorkerState?.stop;
  if (process.env.VOICE_PRESENCE_WORKER_MODE === "standalone" && process.env.VOICE_PRESENCE_ENABLED === "true" && !stopWorker) {
    throw new Error("Voice presence worker did not register");
  }
  if (!stopping) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  }
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { default: next } = await import("next");
    const app = next({ dev: false, hostname: "127.0.0.1", port: 3000 });
    await startGameNightServer(app);
  } catch {
    console.error("[gamenight] server failed to start");
    process.exit(1);
  }
}
