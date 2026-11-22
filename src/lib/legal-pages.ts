/**
 * Pages légales publiques (mentions légales, confidentialité, conditions).
 * Derrière le drapeau `LEGAL_PAGES_ENABLED` (éteint par défaut, actif uniquement
 * si la valeur vaut exactement `true`) : éteint, les trois routes répondent 404
 * et aucun lien n'est affiché. Les informations propres à l'éditeur ne sont
 * JAMAIS inventées : tant qu'une variable est vide, la page affiche « À COMPLÉTER ».
 */
export const LEGAL_TO_COMPLETE = "À COMPLÉTER";
/** Date de dernière mise à jour des trois textes : à changer à chaque modification de leur contenu. */
export const LEGAL_LAST_UPDATED = "22 novembre 2026";
export const LEGAL_UPDATE_NOTICE = `Dernière mise à jour : ${LEGAL_LAST_UPDATED}`;
/** Éditeur nommé dans les conditions d'utilisation (décision du propriétaire du 22/11/2026). */
export const LEGAL_PUBLISHER_NAME = "ZeyFro";

export const LEGAL_LINKS = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/confidentialite", label: "Politique de confidentialité" },
  { href: "/conditions", label: "Conditions d’utilisation" },
] as const;

type Env = Record<string, string | undefined>;

export function isLegalPagesEnabled(env: Env = process.env): boolean {
  return env.LEGAL_PAGES_ENABLED === "true";
}

function clean(value: string | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

export type LegalConfig = {
  /** Éditeur : nom et coordonnées, ou association (texte libre fourni par Maxime). */
  publisher: string | null;
  /** Directeur de la publication. */
  director: string | null;
  /** Adresse e-mail de contact (RGPD, signalement de contenu illicite). */
  contactEmail: string | null;
  /** Âge minimum d'utilisation : 13, 15 ou 16 seulement. */
  minAge: 13 | 15 | 16 | null;
};

export function getLegalConfig(env: Env = process.env): LegalConfig {
  const email = clean(env.LEGAL_CONTACT_EMAIL);
  const age = clean(env.LEGAL_MIN_AGE);
  return {
    publisher: clean(env.LEGAL_PUBLISHER),
    director: clean(env.LEGAL_PUBLICATION_DIRECTOR),
    contactEmail: email && EMAIL.test(email) ? email : null,
    minAge: age === "13" || age === "15" || age === "16" ? (Number(age) as 13 | 15 | 16) : null,
  };
}
