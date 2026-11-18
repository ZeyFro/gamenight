import { resolveAbsoluteUrl } from "@/lib/app-url";

/**
 * Lien GameNight dans les réponses Discord — **jamais** de domaine en dur.
 *
 * `resolveAbsoluteUrl` dérive l'origine des variables Vercel
 * (`VERCEL_PROJECT_PRODUCTION_URL` en Production, `VERCEL_URL` en Preview).
 * En local ou hors Vercel, la fonction renvoie `null` : les messages restent
 * alors lisibles sans lien plutôt que d'afficher une URL inventée.
 */
export function gameNightUrl(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!path.startsWith("/")) return null;
  return resolveAbsoluteUrl(path, {
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_URL: env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

/** Ligne « Ouvre GameNight : … » ou `null` si l'URL n'est pas déterminable. */
export function gameNightLine(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const url = gameNightUrl(path, env);
  return url ? `Ouvre GameNight : ${url}` : null;
}

/** Ajoute la ligne de lien à un bloc de texte, sans le dépasser. */
export function withGameNightLink(
  content: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  max = 1_900
): string {
  const line = gameNightLine(path, env);
  if (!line || content.includes(line)) return content.slice(0, max);
  return `${content}\n${line}`.slice(0, max);
}
