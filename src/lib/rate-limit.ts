/**
 * Rate limiting léger pour les server actions (Sprint 1, fiabilisation) —
 * rien n'empêchait jusqu'ici un client de spammer un bouton (vote,
 * création de soirée…) et d'envoyer des dizaines de requêtes DB en
 * quelques secondes.
 *
 * `Map` en mémoire du process, sans dépendance externe (pas de Redis, pas
 * de service payant) : suffisant pour une app à ~6 users sur Vercel
 * serverless — chaque instance a son propre compteur, remis à zéro à
 * chaque cold start, ce qui est un compromis acceptable à cette échelle
 * (documenté, pas un oubli). Clé = `action:userId` uniquement (pas
 * l'IP suggérée en exemple) : toutes les actions ciblées ici passent déjà
 * par `getCurrentUser()` avant d'atteindre ce contrôle — l'utilisateur
 * Discord authentifié est une clé plus stable et plus significative que
 * l'IP pour cette app (pas de rate limiting pré-auth à couvrir ici).
 *
 * Fenêtre glissante (pas un simple compteur à fenêtre fixe, qui autorise
 * un double burst à la frontière de deux fenêtres) : chaque bucket garde
 * les timestamps des requêtes récentes, élagués à chaque appel.
 */

interface RateLimitBucket {
  timestamps: number[];
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitOptions {
  /** Nombre de requêtes autorisées par fenêtre. */
  limit?: number;
  /** Taille de la fenêtre glissante, en ms. */
  windowMs?: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * `true` si la requête est autorisée (et alors comptabilisée), `false` si
 * la limite est atteinte pour cette fenêtre — à charge de l'appelant de
 * dégrader proprement (ne jamais lever d'exception ici : un throw dans une
 * server action invoquée depuis un `<form action=…>` sans wrapper client
 * remonterait jusqu'à `error.tsx`, bien trop sévère pour "tu vas un peu
 * vite").
 */
export function checkRateLimit(
  userId: string,
  action: string,
  { limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS }: RateLimitOptions = {}
): boolean {
  const key = `${action}:${userId}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    return false;
  }

  bucket.timestamps.push(now);
  return true;
}

/** Message FR standard à afficher en toast quand `checkRateLimit` refuse. */
export const RATE_LIMIT_MESSAGE =
  "Doucement ! Trop de requêtes, réessaie dans quelques secondes.";

/** Clé d'erreur conventionnelle utilisée dans les `Record<string, string>` d'erreurs existants de l'app (ex. `ERROR_MESSAGES` d'`EditGameDialog`, `?error=` de `/sessions`). */
export const RATE_LIMIT_ERROR_KEY = "rate_limited";
