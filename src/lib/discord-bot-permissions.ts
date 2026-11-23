/**
 * Permissions de serveur que le bot GameNight doit garder une fois le droit Administrateur retiré
 * (docs/PERMISSIONS_BOTS.md, docs/PHASE_TEST.md § « Droits minimaux de GameNight »).
 *
 * « Mentionner @everyone, @here et tous les rôles » (bit 17) — décision de Maxime du 23/11/2026 : les rôles du serveur
 * (Gaming, Minecraft, Yama, Otaku, Chef-Otaku, The-Hell, Citoyen-Des-Etoile, Ranker, Régulars…) ne sont pas
 * mentionnables par tout le monde ; sans ce droit, un ping de rôle envoyé par le bot n'atteint personne. Le code ne
 * pingue aujourd'hui que des membres (aucun besoin de ce droit) et jamais @everyone/@here (retiré dans discord-rest.ts) ;
 * le droit est gardé pour les pings de rôle de jeu (`buildGameRolePing`, question Q19) — gardé par
 * `discord-bot-permissions.test.ts`.
 */
export const MENTION_EVERYONE_BIT = BigInt(17);
const ADMINISTRATOR = BigInt(8);

export const GAMENIGHT_BOT_PERMISSIONS: ReadonlyArray<readonly [bigint, string]> = [
  [BigInt(4), "Gérer les salons"],
  [BigInt(10), "Voir les salons"],
  [BigInt(11), "Envoyer des messages"],
  [BigInt(14), "Intégrer des liens"],
  [BigInt(16), "Voir l’historique des messages"],
  [MENTION_EVERYONE_BIT, "Mentionner @everyone, @here et tous les rôles"],
  [BigInt(20), "Se connecter"],
  [BigInt(21), "Parler"],
  [BigInt(28), "Gérer les rôles"],
  [BigInt(34), "Gérer les fils"],
  [BigInt(35), "Créer des fils publics"],
  [BigInt(36), "Créer des fils privés"],
  [BigInt(38), "Envoyer des messages dans les fils"],
];

/** Masque d'invitation du bot (13 permissions) : 395408788496. */
export const GAMENIGHT_BOT_PERMISSION_MASK = GAMENIGHT_BOT_PERMISSIONS.reduce((mask, [bit]) => mask | (BigInt(1) << bit), BigInt(0));

/** Permissions manquantes au niveau du serveur (Administrateur = aucune). */
export function missingBotPermissions(permissions: bigint): string[] {
  if (permissions & ADMINISTRATOR) return [];
  return GAMENIGHT_BOT_PERMISSIONS.filter(([bit]) => !(permissions & (BigInt(1) << bit))).map(([, label]) => label);
}

/** Permissions de serveur cumulées du bot : rôle @everyone (id = serveur) + ses rôles. */
export function botGuildPermissions(guildId: string, botRoleIds: readonly string[], roles: ReadonlyArray<{ id: string; permissions: string }>): bigint {
  return roles
    .filter(role => role.id === guildId || botRoleIds.includes(role.id))
    .reduce((mask, role) => mask | (/^\d+$/.test(role.permissions) ? BigInt(role.permissions) : BigInt(0)), BigInt(0));
}
