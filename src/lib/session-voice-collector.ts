import { createVoiceGatewayCollector, voiceGatewayConfig } from "./discord-voice-gateway";
import { sessionVoiceConfig } from "./session-voice-config";
import { storeSessionVoiceInterval } from "./session-voice-presence";

type CollectorOptions = Parameters<typeof createVoiceGatewayCollector>[1];

export function createSessionVoiceCollector(
  env: Record<string, string | undefined>,
  options: Omit<CollectorOptions, "onInterval"> & { onPersistenceError: (error: unknown) => void },
) {
  const gateway = voiceGatewayConfig(env);
  const session = sessionVoiceConfig(env);
  if (!gateway && !session) return null;
  if (!gateway || !session || gateway.guildId !== session.guildId || gateway.channelIds.join(",") !== session.channelIds.join(",")) {
    throw new Error("Voice Gateway and session configuration must match");
  }

  const { onPersistenceError, ...collectorOptions } = options;
  const pending = new Set<Promise<void>>();
  const collector = createVoiceGatewayCollector(gateway, {
    ...collectorOptions,
    onInterval: interval => {
      const write = storeSessionVoiceInterval(session, interval)
        .then(() => undefined, onPersistenceError)
        .finally(() => pending.delete(write));
      pending.add(write);
    },
  });
  return {
    start: () => collector.start(),
    async stop() {
      collector.stop();
      await Promise.allSettled(pending);
    },
  };
}
