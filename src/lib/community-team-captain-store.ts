import { prisma } from "@/lib/prisma";

/**
 * Accès à la source officielle de capitainerie — **isolé** du reste du code.
 *
 * `CommunityTeam.captainId` est préparé par les PR #370/#408 et n'existe pas
 * encore en Production. Ce module :
 * - lit `captainId` quand la colonne existe ;
 * - retombe explicitement sur `createdById` (transition) quand elle n'existe
 *   pas, en signalant `supported: false` ;
 * - n'écrit **jamais** `createdById` : une passation ne remplace pas le
 *   créateur historique.
 *
 * Aucune autre source de capitainerie ne doit être introduite ailleurs.
 */
export interface CaptainRow {
  teamId: string;
  createdById: string;
  captainId: string | null;
}

export interface CaptainStore {
  /** `false` tant que la colonne `captainId` n'est pas migrée. */
  supported: boolean;
  load(communityId: string, teamIds?: string[]): Promise<Map<string, CaptainRow>>;
  /**
   * Pose `captainId` si le capitaine attendu correspond encore (écriture
   * conditionnelle). Retourne le nombre de lignes modifiées.
   */
  setCaptain(input: {
    teamId: string;
    communityId: string;
    expectedCaptainId: string;
    newCaptainId: string;
  }): Promise<number>;
}

function columnMissing(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "P2022" || (error as Error)?.message?.includes("captainId") === true;
}

/** Store Prisma réel : détection de colonne par lecture, sans DDL. */
export async function createPrismaCaptainStore(): Promise<CaptainStore> {
  let supported = true;
  try {
    await prisma.communityTeam.findFirst({ select: { captainId: true } });
  } catch (error) {
    if (!columnMissing(error)) throw error;
    supported = false;
  }

  return {
    supported,
    async load(communityId, teamIds) {
      type Row = { id: string; createdById: string; captainId?: string | null };
      const where = { communityId, ...(teamIds ? { id: { in: teamIds } } : {}) };
      let rows: Row[];
      if (supported) {
        try {
          rows = await prisma.communityTeam.findMany({
            where,
            select: { id: true, createdById: true, captainId: true },
          });
        } catch (error) {
          if (!columnMissing(error)) throw error;
          supported = false;
          rows = await prisma.communityTeam.findMany({ where, select: { id: true, createdById: true } });
        }
      } else {
        rows = await prisma.communityTeam.findMany({ where, select: { id: true, createdById: true } });
      }
      return new Map(
        rows.map((row) => [
          row.id,
          { teamId: row.id, createdById: row.createdById, captainId: row.captainId ?? null },
        ])
      );
    },
    async setCaptain(input) {
      if (!supported) return 0;
      const updated = await prisma.communityTeam.updateMany({
        where: {
          id: input.teamId,
          communityId: input.communityId,
          OR: [{ captainId: input.expectedCaptainId }, { captainId: null, createdById: input.expectedCaptainId }],
        },
        // Jamais `createdById` : le créateur historique reste intact.
        data: { captainId: input.newCaptainId },
      });
      return updated.count;
    },
  };
}

/** Store mémoire pour les tests et la simulation — même contrat. */
export function createMemoryCaptainStore(
  seed: Array<{ teamId: string; createdById: string; captainId?: string | null }> = [],
  options: { supported?: boolean } = {}
): CaptainStore & { rows: Map<string, CaptainRow> } {
  const rows = new Map<string, CaptainRow>(
    seed.map((row) => [row.teamId, { teamId: row.teamId, createdById: row.createdById, captainId: row.captainId ?? null }])
  );
  return {
    supported: options.supported !== false,
    rows,
    async load(communityId, teamIds) {
      return new Map(
        [...rows.values()]
          .filter((row) => !teamIds || teamIds.includes(row.teamId))
          .map((row) => [row.teamId, { ...row }])
      );
    },
    async setCaptain(input) {
      const row = rows.get(input.teamId);
      if (!row) return 0;
      const current = row.captainId ?? row.createdById;
      if (current !== input.expectedCaptainId) return 0;
      rows.set(input.teamId, { ...row, captainId: input.newCaptainId });
      return 1;
    },
  };
}
