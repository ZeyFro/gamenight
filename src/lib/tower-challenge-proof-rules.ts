import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createTowerChallengeProofCode(): string {
  return "TWR-" + Array.from(randomBytes(8), value => CODE_ALPHABET[value & 31]).join("");
}

export function proofTextIncludesTowerCode(proofText: string, code: string): boolean {
  return proofText.toUpperCase().includes(code);
}

/**
 * Variante acceptée : photo d'écran de TV (console sans capture native) où le code de preuve est
 * visible. Le membre l'annonce avec la mention « photo TV » ou « [TV] » dans la description ; le
 * code n'est alors pas exigé dans le texte, car il doit être lisible sur la photo. Aucune IA : ce
 * sont les votants qui vérifient la photo (voir `towerTvPhotoReviewHint`).
 */
const TV_PHOTO_MARKER = /\[tv\]|\bphoto\s+(?:d[e'’]\s*)?(?:l[’']\s*)?(?:(?:écran|ecran)\s+)?(?:de\s+)?(?:la\s+)?tv\b|\b(?:écran|ecran)\s+tv\b/i;

export type TowerProofVariant = "CODE_IN_TEXT" | "TV_PHOTO_WITH_CODE";

export function detectTowerProofVariant(proofText: string, code: string): TowerProofVariant | null {
  if (proofTextIncludesTowerCode(proofText, code)) return "CODE_IN_TEXT";
  return TV_PHOTO_MARKER.test(proofText) ? "TV_PHOTO_WITH_CODE" : null;
}

export function towerProofSatisfiesCodeRule(proofText: string, code: string): boolean {
  return detectTowerProofVariant(proofText, code) !== null;
}

/** Consigne affichée aux votants quand la preuve est une photo d'écran TV : à eux de vérifier le code. */
export function towerTvPhotoReviewHint(proofText: string, code: string): string | null {
  return detectTowerProofVariant(proofText, code) === "TV_PHOTO_WITH_CODE"
    ? "📺 Photo d’écran TV : vérifie que le code " + code + " est bien lisible sur la photo avant de voter."
    : null;
}
