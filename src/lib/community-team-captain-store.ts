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

/**
 * Pont typé vers une colonne volontairement absente du schéma de cette branche.
 *
 * `CommunityTeam.captainId` est apporté par la migration de la PR #370 absente
 * d'ici : le client Prisma généré ne connaît donc pas le champ. L'accès se fait
 * par nom (cast), ce qui fonctionne dès que la colonne est migrée et échoue en
 * P2022 sinon — exactement le contrat `supported: false` ci-dessous. Aucune
 * migration dupliquée, aucune écriture de `createdById`.
 */
interface CaptainColumnClient {
  findFirst(args: { select: { captainId: true } }): Promise<{ captainId?: string | null } | null>;
  findMany(args: {
    where: { communityId: string; id?: { in: string[] } };
    select: { id: true; createdById: true; captainId?: true };
  }): Promise<Array<{ id: string; createdById: string; captainId?: string | null }>>;
  updateMany(args: { where: Record<string, unknown>; data: { captainId: string } }): Promise<{ count: number }>;
}

function teamWithCaptainColumn(): CaptainColumnClient {
  return prisma.communityTeam as unknown as CaptainColumnClient;
}

/** Store Prisma réel : détection de colonne par lecture, sans DDL. */
export async function createPrismaCaptainStore(): Promise<CaptainStore> {
  const teamRow = teamWithCaptainColumn();
  let supported = true;
  try {
    await teamRow.findFirst({ select: { captainId: true } });
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
          rows = await teamRow.findMany({
            where,
            select: { id: true, createdById: true, captainId: true },
          });
        } catch (error) {
          if (!columnMissing(error)) throw error;
          supported = false;
          rows = await teamRow.findMany({ where, select: { id: true, createdById: true } });
        }
      } else {
        rows = await teamRow.findMany({ where, select: { id: true, createdById: true } });
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
      const updated = await teamRow.updateMany({
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
