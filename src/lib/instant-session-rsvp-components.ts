import type { DiscordActionRow } from "@/lib/discord-rest";

export function instantSessionRsvpComponents(id: string): DiscordActionRow[] {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[a-f0-9]{64}$/i.test(process.env.DISCORD_APP_PUBLIC_KEY ?? "") || !/^\d+$/.test(process.env.DISCORD_CLIENT_ID ?? "")) return [];
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Je rejoins", custom_id: `gn:instant:join:${id}` },
    { type: 2, style: 2, label: "Je quitte", custom_id: `gn:instant:leave:${id}` },
  ] }];
}

export function parseInstantSessionRsvpId(value: string) {
  const match = /^gn:instant:(join|leave):([a-zA-Z0-9_-]{1,64})$/.exec(value);
  return match ? { kind: match[1] as "join" | "leave", sessionId: match[2] } : null;
}
