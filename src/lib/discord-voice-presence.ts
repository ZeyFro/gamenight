export type VoiceVisit = { channelId: string; startedAt: number };
export type VoiceStateEvent = { memberKey: string; channelId: string | null; at: number };
export type VoiceInterval = { memberKey: string; channelId: string; startedAt: number; endedAt: number };

// shortcut: active visits exist only in memory; choose durable recovery after scope and retention are approved.
export function applyVoiceState(active: ReadonlyMap<string, VoiceVisit>, event: VoiceStateEvent): {
  active: Map<string, VoiceVisit>;
  closed: VoiceInterval | null;
} {
  if (!Number.isFinite(event.at) || event.at < 0) throw new Error("Invalid voice event time");
  const next = new Map(active);
  const previous = next.get(event.memberKey);
  if (previous?.channelId === event.channelId || (previous && event.at < previous.startedAt)) {
    return { active: next, closed: null };
  }
  if (event.channelId) next.set(event.memberKey, { channelId: event.channelId, startedAt: event.at });
  else next.delete(event.memberKey);
  return {
    active: next,
    closed: previous ? { memberKey: event.memberKey, channelId: previous.channelId, startedAt: previous.startedAt, endedAt: event.at } : null,
  };
}
