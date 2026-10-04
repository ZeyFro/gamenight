import type { Metadata } from "next";
import { getValidSession } from "@/lib/valid-session";
import { pageMetadata } from "@/lib/page-title";

/**
 * Titre d'onglet DYNAMIQUE (nom du jeu, du pote…) pour les pages à
 * identifiant — suite de `pageMetadata` (`src/lib/page-title.ts`).
 *
 * Derrière le drapeau `PAGE_TITLES_DYNAMIC_ENABLED` (éteint par défaut, actif
 * uniquement si la valeur vaut exactement `true`) ET le drapeau de base
 * `PAGE_TITLES_ENABLED` : sinon on renvoie le titre statique de
 * `pageMetadata`, sans aucune requête supplémentaire.
 *
 * Le nom n'est lu que pour une session valide (même garde légère que les
 * routes API : pas de `touchStreak`, reconnexion forcée respectée) : un
 * visiteur non connecté n'obtient jamais un nom dans le `<title>`. `lookupName`
 * ne doit renvoyer que des données déjà visibles de tout membre connecté.
 */
export function isDynamicPageTitleEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.PAGE_TITLES_ENABLED === "true" && env.PAGE_TITLES_DYNAMIC_ENABLED === "true";
}

export async function dynamicPageMetadata(
  fallbackTitle: string,
  lookupName: () => Promise<string | null | undefined>
): Promise<Metadata> {
  if (!isDynamicPageTitleEnabled()) return pageMetadata(fallbackTitle);

  const session = await getValidSession();
  if (!session) return pageMetadata(fallbackTitle);

  const name = (await lookupName())?.trim();
  return { title: name ? name.slice(0, 80) : fallbackTitle };
}
