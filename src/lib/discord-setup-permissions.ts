/** Discord permissions are decimal strings; thread bits exceed 32 bits. */
export const SETUP_PERMISSIONS = [
  [BigInt(4), "Gérer les salons"],
  [BigInt(10), "Voir les salons"],
  [BigInt(11), "Envoyer des messages"],
  [BigInt(14), "Intégrer des liens"],
  [BigInt(16), "Voir l’historique des messages"],
  [BigInt(34), "Gérer les fils"],
  [BigInt(35), "Créer des fils publics"],
  [BigInt(36), "Créer des fils privés"],
  [BigInt(38), "Envoyer des messages dans les fils"],
] as const;
export const BOT_CHANNEL_PERMISSIONS = SETUP_PERMISSIONS.reduce((mask, [bit]) => mask | (BigInt(1) << bit), BigInt(0));
export const MEMBER_CHANNEL_PERMISSIONS = (BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(16)) | (BigInt(1) << BigInt(38));
export const MEMBER_CHANNEL_DENY = (BigInt(1) << BigInt(11)) | (BigInt(1) << BigInt(35)) | (BigInt(1) << BigInt(36));
export type PermissionOverwrite = { id: string; type: number; allow: string; deny: string };

export function missingSetupPermissions(permissions: bigint): string[] {
  if (permissions & BigInt(8)) return [];
  return SETUP_PERMISSIONS.filter(([bit]) => !(permissions & (BigInt(1) << bit))).map(([, label]) => label);
}

export function channelPermissions(base: bigint, guildId: string, botId: string, roles: string[], overwrites: PermissionOverwrite[]): bigint {
  if (base & BigInt(8)) return base;
  let permissions = base;
  const apply = (allow: bigint, deny: bigint) => { permissions = (permissions & ~deny) | allow; };
  const everyone = overwrites.find((o) => o.type === 0 && o.id === guildId);
  if (everyone) apply(BigInt(everyone.allow), BigInt(everyone.deny));
  let allow = BigInt(0), deny = BigInt(0);
  for (const o of overwrites.filter((o) => o.type === 0 && o.id !== guildId && roles.includes(o.id))) {
    allow |= BigInt(o.allow); deny |= BigInt(o.deny);
  }
  apply(allow, deny);
  const member = overwrites.find((o) => o.type === 1 && o.id === botId);
  if (member) apply(BigInt(member.allow), BigInt(member.deny));
  return permissions;
}
