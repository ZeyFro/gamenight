import type { DiscordActionRow } from "@/lib/discord-rest";
import { wallClockNow } from "@/lib/wallclock";

export function parseSessionRsvpId(value: string) {
  const match = /^gn:seat:(join|leave):([a-zA-Z0-9_-]{1,64})$/.exec(value);
  return match ? { kind: match[1] as "join" | "leave", sessionId: match[2] } : null;
}

/** Composants classiques compatibles avec les embeds existants, sans Components V2. */
export function sessionRsvpComponents(session: { id: string; status: string; date: Date; attendanceCapacity: number | null }): DiscordActionRow[] {
  if (!/^[a-f0-9]{64}$/i.test(process.env.DISCORD_APP_PUBLIC_KEY ?? "") || !/^\d+$/.test(process.env.DISCORD_CLIENT_ID ?? "") || session.status !== "SCHEDULED" || session.date <= wallClockNow()) return [];
  if (!parseSessionRsvpId(`gn:seat:join:${session.id}`)) return [];
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Je viens", custom_id: `gn:seat:join:${session.id}` },
    { type: 2, style: 2, label: "Je viens pas", custom_id: `gn:seat:leave:${session.id}` },
  ] }];
}
