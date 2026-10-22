import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export async function startGameNightServer(app, port = 3000) {
  const workerState = globalThis.__gamenightVoicePresenceWorkerState ??= { sessionStopper: null };
  workerState.hostOwnsSignals = true;
  const server = createServer(app.getRequestHandler());
  let stopWorker;
  let stopping;
  const preparing = Promise.resolve().then(() => app.prepare());

  const shutdown = () => {
    stopping ??= (async () => {
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
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

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
