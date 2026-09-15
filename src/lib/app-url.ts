export interface VercelEnvVars {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

/**
 * Sprint 5 suite (lien Discord annonce tournoi) — origine absolue de
 * l'app, sans domaine codé en dur : dérivée des variables que Vercel
 * injecte automatiquement à l'exécution, sur TOUT déploiement (Production
 * comme Preview), sans configuration côté projet — jamais lues nulle part
 * ailleurs dans ce dépôt avant ce chantier (confirmé par recherche avant
 * d'écrire ce fichier).
 *
 * - `VERCEL_ENV === "production"` → `VERCEL_PROJECT_PRODUCTION_URL`, le
 *   domaine stable assigné à la Production (ou le domaine personnalisé
 *   s'il y en a un).
 * - Sinon (Preview, ou toute autre valeur) → `VERCEL_URL`, l'URL unique
 *   du déploiement courant — c'est justement ce qu'on veut pour un lien
 *   Preview : pointer vers CE déploiement, pas vers la Production.
 *
 * Renvoie `null` si aucune des deux n'est disponible (dev local, ou —
 * cas qui ne devrait jamais arriver sur Vercel — variables absentes) :
 * à l'appelant de dégrader explicitement (jamais un lien construit sur
 * une chaîne vide/`"undefined"`).
 */
export function resolveAppOrigin(env: VercelEnvVars): string | null {
  const host =
    env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** Combine `resolveAppOrigin` avec un chemin (ex. `/tournois/abc123`) — `null` si l'origine n'a pas pu être résolue. */
export function resolveAbsoluteUrl(path: string, env: VercelEnvVars): string | null {
  const origin = resolveAppOrigin(env);
  return origin ? `${origin}${path}` : null;
}
