import type { Metadata } from "next";

/**
 * Titre d'onglet par page (`%s · GameNight`, gabarit défini dans `layout.tsx`).
 * Derrière le drapeau `PAGE_TITLES_ENABLED` (éteint par défaut, actif
 * uniquement si la valeur vaut exactement `true`) : éteint, la page n'exporte
 * aucun titre et garde le « GameNight » du layout racine.
 */
export function pageMetadata(title: string): Metadata {
  return process.env.PAGE_TITLES_ENABLED === "true" ? { title } : {};
}
