import type { DiscordActionRow } from "@/lib/discord-rest";

export function tournamentRsvpComponents(id: string, acceptingRegistrations: boolean): DiscordActionRow[] {
  if (!acceptingRegistrations || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[a-f0-9]{64}$/i.test(process.env.DISCORD_APP_PUBLIC_KEY ?? "") || !/^\d+$/.test(process.env.DISCORD_CLIENT_ID ?? "")) return [];
  return [{ type: 1, components: [{ type: 2, style: 3, label: "Je viens", custom_id: `gn:tournament:join:${id}` }] }];
}

export function parseTournamentRsvpId(value: string) {
  const match = /^gn:tournament:join:([a-zA-Z0-9_-]{1,64})$/.exec(value);
  return match ? { tournamentId: match[1] } : null;
}
