import { prisma } from "@/lib/prisma";

/**
 * Alerte avant saturation de l'hébergement gratuit (décision de Maxime Q11–Q12, 23/11/2026, docs/HEBERGEMENT.md).
 * Interrupteur `HOSTING_ALERT_ENABLED` : éteint par défaut, actif seulement si la valeur vaut exactement `true`.
 *
 * Mesure, en LECTURE SEULE : la taille de la base (`pg_database_size`) par SQL, avec la connexion existante, sans clé
 * supplémentaire. Seuils : 70 % = alerte, 90 % = critique.
 *
 * Le TEMPS DE CALCUL du mois (limite Neon la plus proche : ~48 h sur 100 h le 22/11) n'est PAS mesuré ici : il n'existe
 * aucun moyen de le lire par SQL, et le lire par l'API Neon exigerait une clé d'accès COMPLET au projet (suppression
 * comprise) et un appel externe que le dépôt interdit. Il reste à relever à la main chaque semaine
 * (Neon → Billing, voir docs/HEBERGEMENT.md et docs/SEMAINE_1.md) ; la réponse le rappelle (`manual`).
 */
export const HOSTING_WARN_PERCENT = 70;
export const HOSTING_CRITICAL_PERCENT = 90;
/** Offre gratuite de Neon relevée dans docs/HEBERGEMENT.md ; la limite se corrige par variable si Neon la change. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 1024 ** 3;

export type UsageLevel = "ok" | "warn" | "critical" | "unknown";
export interface UsageMetric {
  key: "storage";
  label: string;
  used: number | null;
  limit: number;
  unit: "octets";
  percent: number | null;
  level: UsageLevel;
}
export interface HostingUsageReport {
  metrics: UsageMetric[];
  level: UsageLevel;
  /** Mesures non automatisables, à relever à la main. */
  manual: string[];
}

type Env = Record<string, string | undefined>;

export function isHostingAlertEnabled(env: Env = process.env): boolean {
  return env.HOSTING_ALERT_ENABLED === "true";
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function levelForPercent(percent: number | null): UsageLevel {
  if (percent === null || !Number.isFinite(percent)) return "unknown";
  if (percent >= HOSTING_CRITICAL_PERCENT) return "critical";
  return percent >= HOSTING_WARN_PERCENT ? "warn" : "ok";
}

/** Module pur : évalue la mesure contre la limite (variable facultative). */
export function evaluateHostingUsage(measures: { storageBytes: number | null }, env: Env = process.env): HostingUsageReport {
  const limit = positiveNumber(env.HOSTING_STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT_BYTES);
  const percent = measures.storageBytes === null ? null : Math.round((measures.storageBytes / limit) * 1000) / 10;
  const level = levelForPercent(percent);
  return {
    metrics: [{ key: "storage", label: "Stockage de la base (Neon)", used: measures.storageBytes, limit, unit: "octets", percent, level }],
    level,
    manual: ["Temps de calcul Neon du mois (100 h sur l'offre gratuite) : à relever à la main dans Neon → Billing"],
  };
}

/** Taille de la base courante (octets). Lève une erreur si la lecture échoue : jamais avalée, l'appelant la journalise. */
export async function readDatabaseSizeBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<{ size: bigint | number | string }[]>`SELECT pg_database_size(current_database())::bigint AS size`;
  const size = Number(rows[0]?.size);
  if (!Number.isFinite(size) || size < 0) throw new Error("taille de base illisible");
  return size;
}
