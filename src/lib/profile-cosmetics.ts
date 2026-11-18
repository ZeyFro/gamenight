/**
 * Catalogue de personnalisation du profil (PROFILE_CUSTOMIZATION_ENABLED).
 *
 * DONNÉES DE PRÉSENTATION UNIQUEMENT : aucun élément ne donne d'étage, d'XP, de priorité ni de droit.
 * Module pur (aucun accès base) : le rendu passe par des classes CSS dérivées de l'identifiant du
 * catalogue (`pc-<id>`, définies dans globals.css), jamais par une valeur libre saisie par un membre.
 *
 * Trois modes d'obtention, sans paiement :
 * - SHOP : boutique XP existante (le solde dépensable `xpBalance` est débité, le niveau reste) ;
 * - EARNED : gagné par un événement (étages, grade, saisons, tournois, défis), jamais achetable ;
 * - BOOSTER : exclusif réservé aux membres portant le drapeau d'éligibilité « booster-support »
 *   (simple drapeau lisible, l'attribution viendra d'une autre PR).
 */

export const PROFILE_COSMETIC_KINDS = [
  "NAME_STYLE", // couleurs / dégradés du pseudo
  "CARD_THEME", // thème de la carte de profil
  "FRAME_FX", // cadre animé autour de l'avatar
  "BANNER_FX", // bannière animée (dégradé CSS, jamais une URL)
  "EFFECT", // brillance, flammes, particules
  "PROFILE_TITLE", // titre sous le pseudo
  "ENTRANCE", // effet d'entrée de la carte
] as const;
export type ProfileCosmeticKind = (typeof PROFILE_COSMETIC_KINDS)[number];

export const PROFILE_KIND_LABELS: Record<ProfileCosmeticKind, string> = {
  NAME_STYLE: "Couleur du pseudo",
  CARD_THEME: "Thème de carte",
  FRAME_FX: "Cadre animé",
  BANNER_FX: "Bannière animée",
  EFFECT: "Effet",
  PROFILE_TITLE: "Titre sous le pseudo",
  ENTRANCE: "Effet d'entrée",
};

/** Champ de `ProfileCustomization` porté par chaque type. */
export const PROFILE_KIND_FIELD = {
  NAME_STYLE: "nameStyleId",
  CARD_THEME: "cardThemeId",
  FRAME_FX: "frameFxId",
  BANNER_FX: "bannerFxId",
  EFFECT: "effectId",
  PROFILE_TITLE: "titleId",
  ENTRANCE: "entranceId",
} as const satisfies Record<ProfileCosmeticKind, string>;
export type ProfileCustomizationField = (typeof PROFILE_KIND_FIELD)[ProfileCosmeticKind];

/** Drapeau d'éligibilité aux exclusifs boosters (`ProfileEntitlement.key`, source BOOSTER). */
export const BOOSTER_ELIGIBILITY_KEY = "booster-support";

export const TOWER_GRADES = ["Régulars", "Irregular", "Ranker", "High Ranker"] as const;
export type EarnGrade = (typeof TOWER_GRADES)[number];

export type EarnRule =
  | { type: "floors"; min: number } // étages gagnés (permanents)
  | { type: "grade"; grade: Exclude<EarnGrade, "Régulars"> } // Ranker : atteint aussi par High Ranker
  | { type: "seasons"; min: number } // saisons Tower terminées
  | { type: "tournamentWins"; min: number } // tournois remportés
  | { type: "challenges"; min: number }; // défis validés

export type Acquisition =
  | { mode: "SHOP"; price: number }
  | { mode: "EARNED"; rule: EarnRule; hint: string }
  | { mode: "BOOSTER"; hint: string };

export type ProfileCosmetic = {
  id: string;
  kind: ProfileCosmeticKind;
  name: string;
  description: string;
  acquisition: Acquisition;
  /**
   * Couleurs d'aperçu (hex) utilisées par la pastille d'aperçu et par le test de contraste.
   * Pour NAME_STYLE : les extrémités du dégradé du texte (affichées sur le fond sombre de l'app).
   * Pour CARD_THEME : [fond de carte, texte].
   */
  preview?: readonly string[];
};

const shop = (price: number): Acquisition => ({ mode: "SHOP", price });
const earned = (rule: EarnRule, hint: string): Acquisition => ({ mode: "EARNED", rule, hint });

export const PROFILE_COSMETICS: readonly ProfileCosmetic[] = [
  // Couleurs et dégradés du pseudo (toutes les couleurs restent lisibles sur #101014 et #1a1a20).
  { id: "name-aurora", kind: "NAME_STYLE", name: "Aurore", description: "Dégradé vert menthe vers bleu glace.", acquisition: shop(450), preview: ["#6ee7b7", "#7dd3fc"] },
  { id: "name-sunset", kind: "NAME_STYLE", name: "Crépuscule", description: "Dégradé corail vers ambre.", acquisition: shop(450), preview: ["#fda4af", "#fcd34d"] },
  { id: "name-orchid", kind: "NAME_STYLE", name: "Orchidée", description: "Dégradé violet vers rose.", acquisition: shop(500), preview: ["#c4b5fd", "#f9a8d4"] },
  { id: "name-gold", kind: "NAME_STYLE", name: "Or des Rankers", description: "Or uni, réservé aux Rankers.", acquisition: earned({ type: "grade", grade: "Ranker" }, "Atteindre le grade Ranker."), preview: ["#fbbf24", "#fde68a"] },
  { id: "name-crimson", kind: "NAME_STYLE", name: "Rouge High Ranker", description: "Dégradé rouge clair, réservé aux High Rankers.", acquisition: earned({ type: "grade", grade: "High Ranker" }, "Atteindre le grade High Ranker."), preview: ["#fca5a5", "#f87171"] },
  { id: "name-violet", kind: "NAME_STYLE", name: "Violet Irregular", description: "Violet de prestige, attribué par le staff.", acquisition: earned({ type: "grade", grade: "Irregular" }, "Grade Irregular attribué par le staff."), preview: ["#d8b4fe", "#c4b5fd"] },
  { id: "name-nitro", kind: "NAME_STYLE", name: "Soutien de la Tour", description: "Dégradé rose et or, exclusif aux boosters.", acquisition: { mode: "BOOSTER", hint: "Réservé aux membres qui boostent le serveur." }, preview: ["#f9a8d4", "#fcd34d"] },

  // Thèmes de carte (fond sombre + texte clair, contraste ≥ 4,5:1 vérifié par test).
  { id: "card-midnight", kind: "CARD_THEME", name: "Minuit", description: "Bleu nuit profond.", acquisition: shop(400), preview: ["#12172b", "#f4f2f8"] },
  { id: "card-forest", kind: "CARD_THEME", name: "Forêt", description: "Vert sombre.", acquisition: shop(400), preview: ["#10201a", "#f4f2f8"] },
  { id: "card-ember", kind: "CARD_THEME", name: "Braise", description: "Brun rouge sombre.", acquisition: shop(400), preview: ["#25140f", "#f4f2f8"] },
  { id: "card-tower", kind: "CARD_THEME", name: "Étages de la Tour", description: "Pierre violette, gagnée avec 10 étages.", acquisition: earned({ type: "floors", min: 10 }, "Gagner 10 étages."), preview: ["#1d1a2b", "#f4f2f8"] },

  // Cadres animés.
  { id: "frame-pulse", kind: "FRAME_FX", name: "Pulsation", description: "Anneau lumineux qui pulse doucement.", acquisition: shop(600) },
  { id: "frame-orbit", kind: "FRAME_FX", name: "Orbite", description: "Anneau dégradé en rotation lente.", acquisition: shop(700) },
  { id: "frame-champion", kind: "FRAME_FX", name: "Champion", description: "Anneau doré, gagné en remportant un tournoi.", acquisition: earned({ type: "tournamentWins", min: 1 }, "Remporter un tournoi."), },
  { id: "frame-nitro", kind: "FRAME_FX", name: "Cadre Soutien", description: "Anneau rose et or, exclusif aux boosters.", acquisition: { mode: "BOOSTER", hint: "Réservé aux membres qui boostent le serveur." } },

  // Bannières animées (dégradés CSS : aucune URL, aucun média).
  { id: "banner-aurora", kind: "BANNER_FX", name: "Aurore boréale", description: "Dégradé vert et bleu qui ondule.", acquisition: shop(600) },
  { id: "banner-nebula", kind: "BANNER_FX", name: "Nébuleuse", description: "Dégradé violet et rose qui dérive.", acquisition: shop(600) },
  { id: "banner-season", kind: "BANNER_FX", name: "Saison accomplie", description: "Dégradé or, gagné en terminant une saison Tower.", acquisition: earned({ type: "seasons", min: 1 }, "Terminer une saison Tower.") },

  // Effets.
  { id: "fx-shine", kind: "EFFECT", name: "Brillance", description: "Reflet qui traverse le pseudo.", acquisition: shop(500) },
  { id: "fx-flames", kind: "EFFECT", name: "Flammes", description: "Lueur de flammes sous la carte.", acquisition: shop(800) },
  { id: "fx-sparkles", kind: "EFFECT", name: "Particules", description: "Petites particules qui montent.", acquisition: shop(800) },
  { id: "fx-flames-ranker", kind: "EFFECT", name: "Flammes de Ranker", description: "Flammes dorées, gagnées avec 30 étages.", acquisition: earned({ type: "floors", min: 30 }, "Gagner 30 étages.") },

  // Titres sous le pseudo.
  { id: "ptitle-climber", kind: "PROFILE_TITLE", name: "Grimpeur", description: "Titre gagné avec 10 étages.", acquisition: earned({ type: "floors", min: 10 }, "Gagner 10 étages.") },
  { id: "ptitle-challenger", kind: "PROFILE_TITLE", name: "Relève-défis", description: "Titre gagné avec 5 défis validés.", acquisition: earned({ type: "challenges", min: 5 }, "Faire valider 5 défis.") },
  { id: "ptitle-veteran", kind: "PROFILE_TITLE", name: "Vétéran de saison", description: "Titre gagné avec 2 saisons terminées.", acquisition: earned({ type: "seasons", min: 2 }, "Terminer 2 saisons Tower.") },
  { id: "ptitle-champion", kind: "PROFILE_TITLE", name: "Champion de tournoi", description: "Titre gagné avec 3 tournois remportés.", acquisition: earned({ type: "tournamentWins", min: 3 }, "Remporter 3 tournois.") },
  { id: "ptitle-supporter", kind: "PROFILE_TITLE", name: "Soutien de la Tour", description: "Titre exclusif aux boosters.", acquisition: { mode: "BOOSTER", hint: "Réservé aux membres qui boostent le serveur." } },
  { id: "ptitle-collector", kind: "PROFILE_TITLE", name: "Collectionneur", description: "Titre de la boutique XP.", acquisition: shop(300) },

  // Effets d'entrée (une seule animation à l'ouverture de la carte).
  { id: "entrance-fade", kind: "ENTRANCE", name: "Fondu", description: "La carte apparaît en fondu.", acquisition: shop(300) },
  { id: "entrance-rise", kind: "ENTRANCE", name: "Montée", description: "La carte monte doucement.", acquisition: shop(350) },
  { id: "entrance-glow", kind: "ENTRANCE", name: "Halo", description: "Un halo accompagne l'apparition.", acquisition: shop(400) },
];

const BY_ID = new Map(PROFILE_COSMETICS.map((item) => [item.id, item]));

export function getProfileCosmetic(id: string | null | undefined): ProfileCosmetic | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** Éléments de la boutique XP issus de la personnalisation (la boutique historique garde ses 7 éléments). */
export function profileShopItems(): { id: string; kind: ProfileCosmeticKind; name: string; price: number }[] {
  return PROFILE_COSMETICS.flatMap((item) =>
    item.acquisition.mode === "SHOP" ? [{ id: item.id, kind: item.kind, name: item.name, price: item.acquisition.price }] : [],
  );
}

/** Prix en XP d'un élément de la boutique, `null` si l'élément n'est pas achetable (gagné, booster ou inconnu). */
export function profileShopPrice(id: string): number | null {
  const item = getProfileCosmetic(id);
  return item?.acquisition.mode === "SHOP" ? item.acquisition.price : null;
}

// ─── Obtention par événement ────────────────────────────────────────────────

export type EarnProgress = {
  floors: bigint | number;
  grade: EarnGrade;
  seasonsCompleted: number;
  tournamentWins: number;
  challengesValidated: number;
};

const GRADE_ORDER: Record<EarnGrade, number> = { "Régulars": 0, Irregular: 1, Ranker: 2, "High Ranker": 3 };

export function ruleSatisfied(rule: EarnRule, progress: EarnProgress): boolean {
  switch (rule.type) {
    case "floors":
      return BigInt(progress.floors) >= BigInt(rule.min);
    case "grade":
      // Irregular est une attribution manuelle (prestige) : seul ce grade exact la satisfait, jamais Ranker ni High Ranker.
      if (rule.grade === "Irregular") return progress.grade === "Irregular";
      return GRADE_ORDER[progress.grade] >= GRADE_ORDER[rule.grade];
    case "seasons":
      return progress.seasonsCompleted >= rule.min;
    case "tournamentWins":
      return progress.tournamentWins >= rule.min;
    case "challenges":
      return progress.challengesValidated >= rule.min;
  }
}

/** Clés gagnées pour une progression donnée (fonction pure ; l'attribution en base est dans profile-customization.ts). */
export function earnedKeysFor(progress: EarnProgress): string[] {
  return PROFILE_COSMETICS.flatMap((item) =>
    item.acquisition.mode === "EARNED" && ruleSatisfied(item.acquisition.rule, progress) ? [item.id] : [],
  );
}

// ─── Vitrine de badges ───────────────────────────────────────────────────────

export const SHOWCASE_MIN = 3;
export const SHOWCASE_MAX = 6;

/** Vitrine valide : vide (désactivée) ou 3 à 6 identifiants distincts. */
export function validateShowcaseSize(ids: readonly string[]): "ok" | "too_few" | "too_many" | "duplicate" {
  if (new Set(ids).size !== ids.length) return "duplicate";
  if (ids.length === 0) return "ok";
  if (ids.length < SHOWCASE_MIN) return "too_few";
  if (ids.length > SHOWCASE_MAX) return "too_many";
  return "ok";
}

/**
 * Personnalisation du profil. OFF par défaut : actif seulement si la valeur vaut exactement `true`.
 * Éteint : aucune requête n'est faite, la boutique garde ses 7 éléments et les profils s'affichent comme avant.
 */
export function isProfileCustomizationEnabled(): boolean {
  return process.env.PROFILE_CUSTOMIZATION_ENABLED === "true";
}

// ─── Contraste (accessibilité) ───────────────────────────────────────────────

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** Rapport de contraste WCAG entre deux couleurs `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
