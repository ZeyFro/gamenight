/**
 * Résolution des rôles de jeu Discord pour la commande `/role` (v1, sans
 * migration ni nouvelle table). Ce module est PUR : aucune requête Discord,
 * aucun accès SQL — uniquement les décisions (doublons, variantes de noms,
 * rôles sensibles, hiérarchie du bot). Il est donc testable sans réseau.
 *
 * Règles tenues ici :
 * - un rôle n'est jamais créé si un rôle de même nom normalisé existe déjà
 *   (variantes « The Legend of Zelda », « the legend of zelda » ou
 *   « Zelda : Breath of the Wild » se répondent) : rejouer une interaction
 *   ne peut pas dupliquer un rôle ;
 * - un rôle technique/administratif n'est jamais attribué : ni par son nom
 *   (admin, modo, staff, bot…), ni par ses permissions, ni s'il est géré par
 *   une intégration (`managed`) ;
 * - un rôle plus haut que le rôle le plus haut du bot n'est jamais attribué
 *   (Discord refuserait de toute façon) ;
 * - en cas d'ambiguïté, on ne devine pas : on propose les candidats.
 */

export interface GuildRoleSummary {
  id: string;
  name: string;
  position: number;
  /** Permissions Discord en chaîne décimale (comme l'API). */
  permissions: string;
  managed: boolean;
}

/** Bits de permissions qui rendent un rôle non attribuable librement. */
const SENSITIVE_PERMISSION_BITS: ReadonlyArray<readonly [bigint, string]> = [
  [BigInt(1) << BigInt(1), "Expulser des membres"],
  [BigInt(1) << BigInt(2), "Bannir des membres"],
  [BigInt(1) << BigInt(3), "Administrateur"],
  [BigInt(1) << BigInt(4), "Gérer les salons"],
  [BigInt(1) << BigInt(5), "Gérer le serveur"],
  [BigInt(1) << BigInt(28), "Gérer les rôles"],
  [BigInt(1) << BigInt(29), "Gérer les webhooks"],
  [BigInt(1) << BigInt(40), "Exclure temporairement"],
];

/** Noms réservés : même sans permission, ces rôles ne sont pas des rôles de jeu. */
const SENSITIVE_NAME_PATTERN =
  /\b(admin|administrateur|administration|modo|moderateur|moderation|staff|owner|fondateur|fondatrice|gerant|securite|bot|bots|systeme|support|direction|responsable|gouvernance|membre du personnel)\b/;

export const DEFAULT_MAX_GUILD_ROLES = 200;
export const MAX_ROLE_NAME_LENGTH = 100;
export const MAX_ROLE_QUERY_LENGTH = 60;
export const MAX_PROFILE_TAG_LENGTH = 40;

/** Minuscules, sans accents, ponctuation réduite à des espaces. */
export function normalizeRoleKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Clé de comparaison sans les préfixes « jeu » / « game » redondants. */
function comparableKey(name: string): string {
  return normalizeRoleKey(name).replace(/^(jeux?|games?)\s+/, "");
}

export function isSensitiveRoleName(name: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(normalizeRoleKey(name));
}

export function sensitivePermissions(role: GuildRoleSummary): string[] {
  if (!/^\d+$/.test(role.permissions)) return ["Permissions illisibles"];
  const permissions = BigInt(role.permissions);
  return SENSITIVE_PERMISSION_BITS.filter(([bit]) => (permissions & bit) !== BigInt(0)).map(([, label]) => label);
}

/** Rôle jamais attribué par `/role` : technique, géré par une intégration, ou @everyone. */
export function isSensitiveRole(role: GuildRoleSummary): boolean {
  return role.managed || role.position <= 0 || isSensitiveRoleName(role.name) || sensitivePermissions(role).length > 0;
}

/** Nom réellement envoyé à Discord ; on conserve la casse choisie par le joueur. */
export function canonicalRoleName(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_NAME_LENGTH);
}

/** Nom du centre d'intérêt GameNight synchronisé avec le profil. */
export function profileTagName(query: string): string {
  return canonicalRoleName(query).slice(0, MAX_PROFILE_TAG_LENGTH).trim();
}

export function queryKey(query: string): string {
  const trimmed = query.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_ROLE_QUERY_LENGTH) return "";
  return comparableKey(trimmed);
}

/** Rôles Discord que le bot peut réellement attribuer (strictement sous son rôle le plus haut). */
export function assignableByBot(role: GuildRoleSummary, botTopPosition: number): boolean {
  return !role.managed && role.position > 0 && role.position < botTopPosition;
}

export interface ExactMatch {
  actions: "exact";
  roles: GuildRoleSummary[];
}

/**
 * Correspondances exactes sur la clé normalisée. Une variante « Zelda » ne
 * remplace pas « The Legend of Zelda : Breath of the Wild » : elle n'est
 * qu'une suggestion, jamais une attribution automatique.
 */
export function exactRoleMatches(roles: GuildRoleSummary[], query: string): GuildRoleSummary[] {
  const key = queryKey(query);
  if (!key) return [];
  return roles.filter((role) => comparableKey(role.name) === key);
}

/** Suggestions (préfixe puis inclusion), hors rôles sensibles, bornées pour l'affichage. */
export function suggestRoleMatches(roles: GuildRoleSummary[], query: string, limit = 5): GuildRoleSummary[] {
  const key = queryKey(query);
  if (!key) return [];
  const scored = roles
    .filter((role) => !isSensitiveRole(role))
    .map((role) => {
      const candidate = comparableKey(role.name);
      const score = candidate === key ? 0 : candidate.startsWith(key) ? 1 : candidate.includes(key) ? 2 : -1;
      return { role, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.role.position - b.role.position);
  return scored.slice(0, limit).map((entry) => entry.role);
}

export type RoleRefusalReason =
  | "invalid_name"
  | "sensitive"
  | "ambiguous"
  | "not_assignable"
  | "creation_forbidden"
  | "guild_full";

export type RoleGrantPlan =
  | { action: "already"; role: GuildRoleSummary }
  | { action: "assign"; role: GuildRoleSummary }
  | { action: "create"; name: string }
  | { action: "refuse"; reason: RoleRefusalReason; candidates: GuildRoleSummary[] };

export interface RoleGrantPlanInput {
  roles: GuildRoleSummary[];
  query: string;
  /** Position du rôle le plus haut du bot ; 0 si inconnue (aucune attribution alors). */
  botTopPosition: number;
  /** Le joueur a-t-il le droit de créer un rôle (Gérer les rôles, ou libre-service activé) ? */
  canCreate: boolean;
  memberRoleIds: string[];
  maxGuildRoles?: number;
}

/**
 * Décide de l'action à effectuer — sans effet de bord. Aucun rôle sensible
 * n'est attribué, même si le joueur cite son nom exact.
 */
export function planRoleGrant(input: RoleGrantPlanInput): RoleGrantPlan {
  if (!queryKey(input.query)) return { action: "refuse", reason: "invalid_name", candidates: [] };
  if (isSensitiveRoleName(input.query)) return { action: "refuse", reason: "sensitive", candidates: [] };

  const exact = exactRoleMatches(input.roles, input.query);
  if (exact.length > 1) return { action: "refuse", reason: "ambiguous", candidates: exact.slice(0, 5) };
  if (exact.length === 1) {
    const role = exact[0];
    if (isSensitiveRole(role)) return { action: "refuse", reason: "sensitive", candidates: [] };
    if (!assignableByBot(role, input.botTopPosition)) return { action: "refuse", reason: "not_assignable", candidates: [] };
    return input.memberRoleIds.includes(role.id) ? { action: "already", role } : { action: "assign", role };
  }

  const suggestions = suggestRoleMatches(input.roles, input.query, 5);
  if (suggestions.length > 0) return { action: "refuse", reason: "ambiguous", candidates: suggestions };
  if (!input.canCreate) return { action: "refuse", reason: "creation_forbidden", candidates: [] };
  if (input.roles.length >= (input.maxGuildRoles ?? DEFAULT_MAX_GUILD_ROLES)) {
    return { action: "refuse", reason: "guild_full", candidates: [] };
  }
  return { action: "create", name: canonicalRoleName(input.query) };
}

/** Position du rôle le plus haut porté par le bot (0 si aucun rôle connu). */
export function topRolePosition(roles: GuildRoleSummary[], roleIds: string[]): number {
  const owned = new Set(roleIds);
  return roles.reduce((top, role) => (owned.has(role.id) ? Math.max(top, role.position) : top), 0);
}
