import { z } from "zod";

/**
 * Irregular attribué à la main (cahier 6.1, décisions du 17/11/2026) : grade de PRESTIGE, aucun droit de
 * modération, jamais déduit des étages. OFF par défaut : actif seulement si la valeur vaut exactement `true`.
 */
export function isTowerIrregularGrantsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOWER_IRREGULAR_GRANTS_ENABLED === "true";
}

export const towerIrregularTargetSchema = z.object({ userId: z.string().trim().min(1).max(191) });

/** Seuls les OWNER / ADMIN de la communauté (jamais un simple membre) attribuent ou retirent Irregular. */
export function canManageTowerIrregular(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export type TowerIrregularGrantState = { revokedAt: Date | null } | null;

/** Irregular n'est effectif que pour une attribution existante et non révoquée. */
export function isIrregularActive(grant: TowerIrregularGrantState): boolean {
  return grant !== null && grant.revokedAt === null;
}
