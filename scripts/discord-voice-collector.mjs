// Node 24.12+ strips TypeScript; only the application's local import paths need resolution.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const source = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = specifier.startsWith("@/")
      ? new URL(`${specifier.slice(2)}.ts`, source)
      : specifier.startsWith(".") && context.parentURL?.startsWith(source.href)
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    return nextResolve(local && existsSync(fileURLToPath(local)) ? local.href : specifier, context);
  },
});

let stage = "arguments";
async function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--run"].includes(mode) || process.argv.length > 3) throw new Error("Usage: node scripts/discord-voice-collector.mjs [--check|--run]");
  if (process.env.VOICE_PRESENCE_ENABLED !== "true") {
    console.log("voice: disabled; no connection opened");
    return;
  }
  stage = "local_approval";
  if (mode === "--run" && process.env.VOICE_PRESENCE_APPROVED !== "true") throw new Error("Local scope, consent and retention approval required before --run");
  stage = "database_configuration";
  if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) throw new Error("Voice database configuration missing");
  stage = "module_load";
  const { createSessionVoiceCollector } = await import("../src/lib/session-voice-collector.ts");
  const { prisma } = await import("../src/lib/prisma.ts");
  stage = "generated_client";
  if (!prisma.sessionVoicePresenceInterval) throw new Error("Generated Prisma client missing voice model");
  let stopping;
  const stop = (code = 0) => {
    if (code) process.exitCode = code;
    return stopping ??= (async () => {
      await collector.stop();
      await prisma.$disconnect();
    })();
  };
  stage = "collector_configuration";
  const collector = createSessionVoiceCollector(process.env, {
    onStatus: status => console.log(JSON.stringify({ event: "voice_status", status, at: new Date().toISOString() })),
    onGap: reason => console.warn(JSON.stringify({ event: "voice_gap", reason, at: new Date().toISOString() })),
    onFatal: code => { console.error(JSON.stringify({ event: "voice_fatal", code })); void stop(1); },
    onPersistenceError: () => { console.error("voice: persistence failed; stopping"); void stop(1); },
  });
  if (mode === "--check") {
    await prisma.$disconnect();
    console.log("voice: configuration and modules OK; no connection opened");
    return;
  }
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  stage = "gateway_start";
  await collector.start();
  console.log("voice: started; awaiting Gateway synchronization");
}

main().catch(() => {
  console.error(JSON.stringify({ event: "voice_startup_failed", stage }));
  process.exitCode = 1;
});
