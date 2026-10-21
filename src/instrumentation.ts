import { voicePresenceWorkerConfig } from "./lib/voice-presence-worker";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;

  const config = voicePresenceWorkerConfig(process.env);
  if (!config) return;

  const { startVoicePresenceWorkerRuntime } = await import("./lib/voice-presence-worker-runtime");
  await startVoicePresenceWorkerRuntime(config);
}
