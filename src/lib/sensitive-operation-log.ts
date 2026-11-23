import { prisma } from "@/lib/prisma";

/**
 * Journal des opérations sensibles (cahier §19.1). Une ligne par action d'administration aboutie ou refusée après
 * contrôle d'accès : qui (identifiant opaque), quoi (nom d'action fixe), où (communauté), sur quoi (identifiant
 * technique) et le résultat (code court). Jamais de texte saisi, de secret ni de jeton.
 *
 * Pas d'avalement d'erreur : si l'écriture échoue, l'erreur remonte à l'appelant (l'opération déjà faite reste
 * faite, mais l'échec du journal est visible au lieu d'être perdu).
 */
export const SENSITIVE_OPERATIONS = [
  "community.activate", "community.channel", "community.guide", "community.free_games", "community.steam_price_alerts",
  "community.group_purchase_plans", "community.attendance_xp", "community.player_classifieds", "community.teams",
  "community.tower_levels_per_floor", "community.session_gallery",
  "player.xp_adjust", "auth.force_relogin",
  "tower.appeal_decide", "tower.arbiter_appoint", "tower.arbiter_configure",
  "cleanup.retry_reward", "cleanup.retry_discord",
  "discord.commands_execute",
] as const;
export type SensitiveOperation = (typeof SENSITIVE_OPERATIONS)[number];

export type SensitiveOperationEntry = {
  actorId: string | null;
  action: SensitiveOperation;
  outcome: string;
  communityId?: string | null;
  target?: string | null;
};

const CODE = /^[a-z0-9_.:-]{1,64}$/i;

/** Garde le seul format attendu (code court ou identifiant) ; toute autre valeur devient « invalid » / null. */
export function normalizeSensitiveOperation(entry: SensitiveOperationEntry) {
  const id = (value: string | null | undefined, max: number) => (typeof value === "string" && value.length > 0 && value.length <= max && /^[\w:.-]+$/.test(value) ? value : null);
  if (!(SENSITIVE_OPERATIONS as readonly string[]).includes(entry.action)) throw new Error(`opération sensible inconnue : ${String(entry.action)}`);
  return {
    actorId: id(entry.actorId, 191),
    action: entry.action,
    outcome: CODE.test(entry.outcome) ? entry.outcome : "invalid",
    communityRef: id(entry.communityId, 191),
    target: id(entry.target, 191),
  };
}

export async function recordSensitiveOperation(entry: SensitiveOperationEntry): Promise<void> {
  await prisma.sensitiveOperationLog.create({ data: normalizeSensitiveOperation(entry) });
}

export const SENSITIVE_LOG_PAGE_SIZE = 100;

/** Dernières opérations, pour /admin/journal (l'appelant a vérifié requireAdmin). */
export async function listSensitiveOperations(limit = SENSITIVE_LOG_PAGE_SIZE) {
  const rows = await prisma.sensitiveOperationLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(Math.max(limit, 1), 500) });
  const actorIds = [...new Set(rows.flatMap(row => (row.actorId ? [row.actorId] : [])))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, discordName: true } }) : [];
  const names = new Map(actors.map(actor => [actor.id, actor.discordName]));
  return rows.map(row => ({ ...row, actorName: row.actorId ? names.get(row.actorId) ?? "Compte inconnu" : "Système" }));
}
