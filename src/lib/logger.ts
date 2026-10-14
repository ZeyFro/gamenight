/**
 * Logging structuré (Sprint 1, fiabilisation — chantier "Logging structuré
 * des erreurs"). Remplace les `console.error`/`console.warn`/`console.log`
 * bruts du codebase par un format JSON exploitable dans Vercel Logs (query
 * par `context`/`level`, alerting éventuel) — sans nouveau service externe
 * (pas de Sentry, pas de LogSnag) : juste du `console` structuré, que
 * Vercel capture déjà automatiquement en prod.
 *
 * `context` identifie la source (ex. "cron:reminders", "steam", "discord",
 * "action:createSession") — même rôle que le préfixe `[steam]`/`[igdb]`
 * déjà utilisé de façon ad hoc dans plusieurs `console.error` existants,
 * juste formalisé en un champ structuré plutôt qu'un préfixe de texte.
 */

type LogMeta = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: "error" | "warn" | "info";
  context: string;
  message: string;
  meta?: LogMeta;
  stack?: string;
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function write(entry: LogEntry, sink: (line: string) => void): void {
  sink(JSON.stringify(entry));
}

/**
 * `error` accepte soit une `Error`/valeur inconnue attrapée par un
 * `catch` (message + stack extraits automatiquement), soit directement un
 * message texte (pas d'erreur JS à proprement parler, ex. un échec métier
 * détecté sans exception).
 */
function error(context: string, error: unknown, meta?: LogMeta): void {
  const { message, stack } = serializeError(error);
  write(
    {
      timestamp: new Date().toISOString(),
      level: "error",
      context,
      message,
      ...(meta ? { meta } : {}),
      ...(stack ? { stack } : {}),
    },
    console.error
  );
}

function warn(context: string, message: string, meta?: LogMeta): void {
  write(
    {
      timestamp: new Date().toISOString(),
      level: "warn",
      context,
      message,
      ...(meta ? { meta } : {}),
    },
    console.warn
  );
}

function info(context: string, message: string, meta?: LogMeta): void {
  write(
    {
      timestamp: new Date().toISOString(),
      level: "info",
      context,
      message,
      ...(meta ? { meta } : {}),
    },
    console.log
  );
}

export const logger = { error, warn, info };
