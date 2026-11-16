/**
 * Avantages Booster Discord — règles PURES, sans base ni réseau.
 *
 * Décision produit : le statut Booster vient UNIQUEMENT de Discord
 * (`premium_since` sur le membre de serveur). Aucun second système concurrent
 * n'est créé, aucun avantage n'est calculé depuis un paiement ou un rôle
 * maison.
 *
 * Interdits tenus ici et vérifiés par test :
 * - aucun droit d'administration ou de modération ;
 * - aucune influence sur les votes de validation des preuves ;
 * - aucun multiplicateur d'étages ni d'XP ;
 * - aucun avantage compétitif (classements, quotas de défis) ;
 * - aucune attribution automatique de rôle sensible ;
 * - aucune création illimitée de rôles ou de salons.
 *
 * Les avantages sont volontairement ESTHÉTIQUES ou d'accès : bannière, mise en
 * avant du profil, personnalisation encadrée d'un espace d'équipe, accès aux
 * salons réservés. Ils expirent avec le boost, mais les données personnelles
 * créées pendant le boost (équipes, historique) restent.
 */

/** Ce qu'un Booster actif obtient — jamais une permission Discord. */
export interface BoosterPerks {
  /** Bannière de profil étendue (teinte/dégradé supplémentaires). */
  extendedBanner: true;
  /** Section de profil supplémentaire (présentation libre, plafonnée). */
  extraProfileSection: true;
  /** Distinction visible sur le profil et dans les listes de membres. */
  badgeLabel: "Booster The Tower";
  /** Personnalisation bornée de l'espace d'équipe (description + emoji). */
  teamSpaceCustomization: { descriptionChars: number; emoji: true };
  /** Accès aux salons communautaires réservés aux boosters. */
  boosterChannels: true;
}

/** Plafonds volontairement bas : une personnalisation, pas un pouvoir. */
export const BOOSTER_TEAM_DESCRIPTION_CHARS = 300;

export const BOOSTER_PERKS: BoosterPerks = {
  extendedBanner: true,
  extraProfileSection: true,
  badgeLabel: "Booster The Tower",
  teamSpaceCustomization: { descriptionChars: BOOSTER_TEAM_DESCRIPTION_CHARS, emoji: true },
  boosterChannels: true,
};

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

export function boosterPerks(active: boolean): BoosterPerks | null {
  return active ? BOOSTER_PERKS : null;
}

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
  if (!Number.isFinite(since)) return "Tu boosts le serveur. Avantages Booster actifs.";
  return `Tu boosts le serveur depuis <t:${Math.floor(since / 1000)}:D>. Avantages Booster actifs.`;
}

/** Contenu de `/boost` (pur). `enabled` vient de `DISCORD_BOOSTER_ENABLED`. */
export function renderBoosterAdvantages(input: {
  active: boolean;
  since: string | null;
  enabled: boolean;
}): string {
  if (!input.enabled) {
    return "Les avantages Booster ne sont pas encore ouverts sur ce serveur.";
  }
  return [
    "💜 **Avantages Booster The Tower**",
    describeBoosterStatus({ active: input.active, since: input.since }),
    "",
    "**Ce que tu obtiens en boostant**",
    "• Bannière de profil étendue et distinction « Booster The Tower ».",
    "• Une section de présentation supplémentaire sur ton profil GameNight.",
    `• Personnalisation de l’espace de ton équipe : description (${BOOSTER_TEAM_DESCRIPTION_CHARS} caractères) et emoji.`,
    "• Accès aux salons communautaires réservés aux boosters.",
    "",
    "**Ce que le boost ne donne jamais**",
    ...BOOSTER_FORBIDDEN.map((item) => `• ${item}.`),
    "",
    "Tes récompenses déjà obtenues restent dans ton historique, même si tu arrêtes de booster. Seuls les avantages exclusifs s’éteignent.",
  ].join("\n");
}
