/**
 * Identifiants Discord de The Tower, centralisés (ils étaient codés en dur dans 9 fichiers).
 *
 * Comportement INCHANGÉ : sans variable d'environnement valide, on retrouve exactement les valeurs
 * historiques. Le serveur suit `TOWER_DISCORD_GUILD_ID` (déjà utilisée par les commandes et défis
 * Tower) quand elle contient un identifiant Discord valide ; une valeur vide ou malformée est ignorée.
 * Le propriétaire reste une constante unique : aucune variable ne l'élargit (ni `ADMIN_DISCORD_IDS`,
 * qui désigne tous les administrateurs).
 */

const LEGACY_TOWER_GUILD_ID = "553922938101825536";
const TOWER_OWNER_DISCORD_ID = "699223334046531636";
const SNOWFLAKE = /^\d{17,20}$/;

/** Serveur Discord de The Tower (outils d'administration, santé). */
export function towerGuildId(env: Record<string, string | undefined> = process.env): string {
  const configured = env.TOWER_DISCORD_GUILD_ID?.trim();
  return configured && SNOWFLAKE.test(configured) ? configured : LEGACY_TOWER_GUILD_ID;
}

/** Vrai uniquement pour le compte Discord du propriétaire (garde d'accès des outils Tower). */
export function isTowerOwner(discordId: string | null | undefined): boolean {
  return typeof discordId === "string" && discordId === TOWER_OWNER_DISCORD_ID;
}
