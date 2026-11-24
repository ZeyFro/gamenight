import { createHash } from "node:crypto";
import { after } from "next/server";

/**
 * Prisma est chargé À L'ÉCRITURE seulement (import dynamique) : les routeurs et les routes qui appellent `persistServerError` restent des
 * modules « purs » à l'import, comme l'exige le workflow `Tower challenge rules` (tests sans client Prisma généré).
 */
let prismaModule: Promise<typeof import("@/lib/prisma")> | undefined;
async function db() {
  prismaModule ??= import("@/lib/prisma");
  return (await prismaModule).prisma;
}

/**
 * Journal d'erreurs serveur minimal (audit du 23/11/2026, « Journaux ») : Vercel Hobby ne garde que 1 h de journaux, une erreur
 * survenue la nuit serait perdue au matin. Appelé depuis les CHEMINS CRITIQUES seulement (crons, routeur d'interactions Discord,
 * échec terminal d'une livraison), jamais depuis tout `logger.error`.
 *
 * - Tâche de fond, meilleur effort : `after()` dans une requête, sinon promesse gérée ; ne lève JAMAIS et ne boucle jamais.
 * - Aucune donnée personnelle : le message est nettoyé (URL, jetons, adresses, identifiants) et tronqué à 300 caractères.
 * - Regroupé par empreinte : une erreur répétée incrémente un compteur au lieu d'écrire 1000 lignes.
 * - Plafond d'écriture par instance (30 par minute) : au-delà, seul un compteur en mémoire avance.
 */
export const ERROR_MESSAGE_MAX = 300;
export const ERROR_WRITES_PER_MINUTE = 30;
export const ERROR_RETENTION_DAYS = 30;

/** Retire de ce qui est stocké tout ce qui ressemble à un secret, une adresse ou un identifiant, puis tronque. */
export function scrubErrorMessage(raw: string): string {
  const cleaned = raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi, "[url]") // URL de tout schéma, y compris avec identifiants intégrés (utilisateur:motdepasse@hôte)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [jeton]")
    .replace(/\b(authorization|token|secret|password|passwd|api[_-]?key|apikey)\b\s*[:=]\s*\S+/gi, "$1=[masqué]")
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[e-mail]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[jeton]") // longues suites : jetons, clés, hachages
    .replace(/\b\d{17,20}\b/g, "[id]") // identifiants Discord
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > ERROR_MESSAGE_MAX ? cleaned.slice(0, ERROR_MESSAGE_MAX - 1) + "…" : cleaned;
}

const SHORT = /^[A-Za-z0-9_.:/-]{1,64}$/;
const short = (value: unknown, fallback: string, max = 64) =>
  typeof value === "string" && value.length <= max && SHORT.test(value) ? value : fallback;

export type ServerErrorEntry = { context: string; code: string; route: string | null; message: string };

export function buildServerErrorEntry(context: string, error: unknown, meta?: { code?: string; route?: string }): ServerErrorEntry {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "erreur non textuelle";
  const errorCode = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name : "Error";
  return {
    context: short(context, "inconnu"),
    code: short(meta?.code, short(typeof errorCode === "string" ? errorCode : null, short(name, "Error"))),
    route: meta?.route ? short(meta.route, "", 96) || null : null,
    message: scrubErrorMessage(raw),
  };
}

/** Empreinte stable : les nombres sont neutralisés pour que « délai 1532 ms » et « délai 1710 ms » se regroupent. */
export function errorFingerprint(entry: ServerErrorEntry): string {
  const stable = entry.message.replace(/\d+/g, "#");
  return createHash("sha256").update([entry.context, entry.code, entry.route ?? "", stable].join("|")).digest("hex").slice(0, 32);
}

let windowStart = 0;
let writesInWindow = 0;
let droppedSinceStart = 0;

/** Plafond par instance et par minute ; à l'extérieur, on ne fait qu'avancer un compteur en mémoire. */
export function allowErrorWrite(now = Date.now()): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    writesInWindow = 0;
  }
  if (writesInWindow >= ERROR_WRITES_PER_MINUTE) {
    droppedSinceStart += 1;
    return false;
  }
  writesInWindow += 1;
  return true;
}

export const droppedErrorWrites = () => droppedSinceStart;
export function resetErrorLogLimiter() {
  windowStart = 0;
  writesInWindow = 0;
  droppedSinceStart = 0;
}

/** Écriture réelle (testable) : crée la ligne ou incrémente le compteur de la même empreinte. */
export async function writeServerError(entry: ServerErrorEntry, now = new Date()): Promise<void> {
  const fingerprint = errorFingerprint(entry);
  await (await db()).serverErrorLog.upsert({
    where: { fingerprint },
    create: { fingerprint, ...entry, createdAt: now, lastAt: now },
    update: { count: { increment: 1 }, lastAt: now, message: entry.message },
  });
}

/**
 * Point d'entrée des chemins critiques. Ne lève jamais. Sans effet en test et sur Vercel Preview (jamais de journal parasite ni
 * d'écriture depuis un aperçu).
 */
export function persistServerError(context: string, error: unknown, meta?: { code?: string; route?: string }): void {
  try {
    if (process.env.NODE_ENV === "test" || process.env.VERCEL_ENV === "preview") return;
    const entry = buildServerErrorEntry(context, error, meta);
    if (!allowErrorWrite()) return;
    const task = () =>
      writeServerError(entry).catch((writeError) => {
        // Seul cas légitime d'erreur avalée du dépôt : le journal d'erreurs ne doit jamais provoquer d'erreur ni boucler
        // (une base en panne ferait écrire ce journal en boucle). On laisse une trace console et on s'arrête là.
        console.error("[error-log] écriture impossible :", writeError instanceof Error ? writeError.message : "erreur inconnue");
      });
    try {
      after(task);
    } catch {
      // Hors requête (script, worker) : `after()` refuse ; la promesse est déjà gérée par le `.catch` ci-dessus.
      void task();
    }
  } catch (unexpected) {
    console.error("[error-log] échec inattendu :", unexpected instanceof Error ? unexpected.message : "erreur inconnue");
  }
}

/** Les 100 dernières erreurs groupées (une ligne par empreinte), pour /admin/erreurs (l'appelant a vérifié requireAdmin). */
export async function listServerErrors(limit = 100) {
  return (await db()).serverErrorLog.findMany({ orderBy: { lastAt: "desc" }, take: limit });
}

/** Purge à 30 jours (cron quotidien `monthly-tasks`, qui tourne même interrupteurs éteints). */
export async function purgeServerErrors(now = new Date(), days = ERROR_RETENTION_DAYS): Promise<number> {
  const result = await (await db()).serverErrorLog.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - days * 86_400_000) } } });
  return result.count;
}
