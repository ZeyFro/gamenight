import { prisma } from "@/lib/prisma";

/**
 * Verrou de création de rôle — coordination réelle entre instances.
 *
 * Deux lectures successives ne suffisent pas : deux requêtes concurrentes
 * peuvent toutes deux voir « rôle absent » avant que l'une ait créé le rôle.
 * On sérialise donc la section critique par une ligne `CronLock` acquise de
 * façon atomique (`updateMany` conditionnel : verrou libre ou périmé).
 *
 * Le verrou est volontairement court (création d'un rôle = un appel Discord) :
 * un verrou périmé (crash, redéploiement) est repris après `STALE_MS`, et le
 * chemin d'échec ne crée rien : il relit les rôles et réutilise l'existant.
 */
export const ROLE_LOCK_STALE_MS = 30_000;
const WAIT_STEP_MS = 250;

export type RoleLockResult<T> = { status: "acquired"; value: T } | { status: "busy" };

function lockName(guildId: string, key: string): string {
  return `discord-role:${guildId}:${key}`.slice(0, 190);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute `run` sous verrou. Retourne `busy` sans exécuter `run` si le verrou
 * n'a pas pu être obtenu dans le budget — l'appelant doit alors relire l'état
 * Discord au lieu de créer.
 */
export async function withRoleCreationLock<T>(input: {
  guildId: string;
  key: string;
  run: () => Promise<T>;
  waitMs?: number;
  now?: () => number;
}): Promise<RoleLockResult<T>> {
  const name = lockName(input.guildId, input.key);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = input.now ?? Date.now;
  const waitMs = input.waitMs ?? 3_000;

  // La ligne peut ne pas exister : `upsert` idempotent, sans écraser un verrou.
  await prisma.cronLock.upsert({ where: { name }, update: {}, create: { name } });

  const deadline = now() + waitMs;
  for (;;) {
    const acquired = await prisma.cronLock.updateMany({
      where: {
        name,
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now() - ROLE_LOCK_STALE_MS) } }],
      },
      data: { lockedAt: new Date(now()), token },
    });
    if (acquired.count === 1) {
      try {
        return { status: "acquired", value: await input.run() };
      } finally {
        // Libération ciblée : on ne libère jamais le verrou d'un autre acteur.
        await prisma.cronLock.updateMany({ where: { name, token }, data: { lockedAt: null, token: null } }).catch(() => undefined);
      }
    }
    if (now() >= deadline) return { status: "busy" };
    await sleep(WAIT_STEP_MS);
  }
}

/** Lecture seule du verrou — utile aux diagnostics et aux tests. */
export async function readRoleLock(guildId: string, key: string) {
  return prisma.cronLock.findUnique({ where: { name: lockName(guildId, key) } });
}
