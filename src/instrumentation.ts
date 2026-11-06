import { voicePresenceWorkerConfig } from "./lib/voice-presence-worker";

export async function register() {
  // Garde positive en ligne : webpack (dev) la replie en constante pour le bundle Edge et en retire l'import
  // dynamique du runtime (sinon web-push -> https-proxy-agent -> 'http' fait planter `next dev --webpack`).
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const config = voicePresenceWorkerConfig(process.env);
    if (!config) return;

    const { startVoicePresenceWorkerRuntime } = await import("./lib/voice-presence-worker-runtime");
    await startVoicePresenceWorkerRuntime(config);
  }
}
