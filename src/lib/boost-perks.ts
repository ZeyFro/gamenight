/**
 * Avantages Booster Discord — règles PURES, sans base ni réseau.
 *
 * Décision produit : le statut Booster vient UNIQUEMENT de Discord
 * (`premium_since` sur le membre de serveur), lu côté serveur. Aucun second
 * système concurrent n'est créé, aucun avantage n'est calculé depuis un
 * paiement ou un rôle maison.
 *
 * SOURCE UNIQUE : `BOOSTER_PERK_DEFINITIONS` est le seul endroit où un avantage
 * est décrit. `/boost` (Discord) et le profil GameNight lisent cette même
 * liste, et chaque entrée déclare son état RÉEL :
 * - `APPLIED`   : codé et visible aujourd'hui, dans le produit ;
 * - `PREPARING` : annoncé, mais pas encore actif — jamais présenté comme actif.
 *
 * Interdits tenus ici et vérifiés par test :
 * - aucun droit d'administration ou de modération ;
 * - aucune influence sur les votes de validation des preuves ;
 * - aucun multiplicateur d'étages ni d'XP ;
 * - aucun avantage compétitif (classements, quotas de défis) ;
 * - aucune attribution automatique de rôle sensible ;
 * - aucune création illimitée de rôles ou de salons.
 *
 * Aucun historique de boost n'est conservé (pas de table, pas de migration) :
 * rien n'est permanent, et aucun texte ne promet le contraire.
 */

/** État réel d'un avantage dans le produit, pas une intention marketing. */
export type BoosterPerkAvailability = "APPLIED" | "PREPARING";

/** Où l'avantage se voit une fois appliqué. */
export type BoosterPerkSurface = "WEB" | "DISCORD" | "BOTH";

export interface BoosterPerkDefinition {
  key: string;
  /** Libellé partagé par `/boost` et le profil : aucune divergence possible. */
  label: string;
  availability: BoosterPerkAvailability;
  surface: BoosterPerkSurface;
}

/** Plafonds volontairement bas : une personnalisation, pas un pouvoir. */
export const BOOSTER_TEAM_DESCRIPTION_CHARS = 300;

/** Nom court de la distinction, réutilisé par le badge web et `/boost`. */
export const BOOSTER_BADGE_LABEL = "Booster The Tower";

export const BOOSTER_PERK_DEFINITIONS = [
  {
    key: "profileBadge",
    label: `Distinction « ${BOOSTER_BADGE_LABEL} » sur ton profil GameNight`,
    availability: "APPLIED",
    surface: "WEB",
  },
  {
    key: "profileRing",
    label: "Halo lumineux autour de ton avatar, visible par la communauté",
    availability: "APPLIED",
    surface: "WEB",
  },
  {
    key: "extendedBanner",
    label: "Bannière de profil étendue",
    availability: "PREPARING",
    surface: "BOTH",
  },
  {
    key: "extraProfileSection",
    label: "Section de présentation supplémentaire sur ton profil",
    availability: "PREPARING",
    surface: "WEB",
  },
  {
    key: "teamSpaceCustomization",
    label: `Personnalisation de l’espace d’équipe : description (${BOOSTER_TEAM_DESCRIPTION_CHARS} caractères) et emoji`,
    availability: "PREPARING",
    surface: "BOTH",
  },
  {
    key: "boosterChannels",
    label: "Accès aux salons communautaires réservés aux boosters",
    availability: "PREPARING",
    surface: "DISCORD",
  },
] as const satisfies readonly BoosterPerkDefinition[];

export type BoosterPerkKey = (typeof BOOSTER_PERK_DEFINITIONS)[number]["key"];

/** Avantages réellement utilisables aujourd'hui. */
export function appliedBoosterPerks(): readonly BoosterPerkDefinition[] {
  return BOOSTER_PERK_DEFINITIONS.filter((perk) => perk.availability === "APPLIED");
}

/** Avantages annoncés mais volontairement pas encore actifs. */
export function preparingBoosterPerks(): readonly BoosterPerkDefinition[] {
  return BOOSTER_PERK_DEFINITIONS.filter((perk) => perk.availability === "PREPARING");
}

/**
 * Liste des capacités explicitement REFUSÉES aux boosters. Codée en dur pour
 * qu'une future PR ne puisse pas ajouter un avantage compétitif sans changer
 * cette liste et son test.
 */
export const BOOSTER_FORBIDDEN = [
  "permissions d’administration ou de modération",
  "poids supplémentaire dans les votes de validation des preuves",
  "multiplicateur d’étages ou d’XP",
  "avantage de classement ou quota de défis supplémentaire",
  "attribution automatique de rôle sensible",
  "création illimitée de rôles ou de salons",
] as const;

export interface BoosterStatusInput {
  active: boolean;
  /** `premium_since` renvoyé par Discord (ISO 8601) ou `null`. */
  since: string | null;
}

/** Ligne lisible pour `/boost` et le profil ; horodatage Discord quand il est connu. */
export function describeBoosterStatus(input: BoosterStatusInput): string {
  if (!input.active) {
    return "Tu ne boosts pas le serveur en ce moment. Les avantages Booster sont inactifs ; tes données personnelles et tes équipes restent intactes.";
  }
  const since = input.since ? Date.parse(input.since) : Number.NaN;
  if (!Number.isFinite(since)) return "Tu boosts le serveur. Statut Booster vérifié.";
  return `Tu boosts le serveur depuis <t:${Math.floor(since / 1000)}:D>. Statut Booster vérifié.`;
}

/** Contenu de `/boost` (pur). `enabled` vient de `DISCORD_BOOSTER_ENABLED`. */
export function renderBoosterAdvantages(input: {
  active: boolean;
  since: string | null;
  enabled: boolean;
}): string {
  if (!input.enabled) {
    return [
      "Les avantages Booster ne sont pas encore ouverts sur ce serveur.",
      "Aucun avantage Booster n’est appliqué pour le moment, et rien n’est promis avant validation.",
    ].join("\n");
  }
  const applied = appliedBoosterPerks();
  const preparing = preparingBoosterPerks();
  return [
    "💜 **Avantages Booster The Tower**",
    describeBoosterStatus({ active: input.active, since: input.since }),
    "Statut lu à la source Discord, côté serveur — jamais depuis ton navigateur. Aucun historique de boost n’est conservé : rien n’est permanent.",
    "",
    "**Déjà appliqué dans GameNight**",
    ...applied.map((perk) => `• ${perk.label}`),
    "",
    input.active
      ? "**En préparation — pas encore actif, même en boostant**"
      : "**En préparation — pas encore actif**",
    ...preparing.map((perk) => `• ${perk.label} — _en préparation_`),
    "",
    "**Ce que le boost ne donne jamais**",
    ...BOOSTER_FORBIDDEN.map((item) => `• ${item}.`),
    "",
    "Tes récompenses déjà obtenues restent dans ton historique. Seuls les avantages exclusifs s’éteignent quand tu arrêtes de booster.",
  ].join("\n");
}
