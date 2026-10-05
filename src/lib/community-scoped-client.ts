import { prisma } from "@/lib/prisma";
import { getDefaultCommunityId } from "@/lib/default-community";
import {
  communityIdFilter,
  getIsolationScope,
  isCommunityIsolationEnabled,
  resolveActiveCommunityScope,
  type IsolationScope,
} from "@/lib/community-isolation";

/**
 * Multi-communautés, PR7 — client Prisma SCOPÉ par communauté. Point de passage
 * unique des PR suivantes (chat, dettes, stats, roulette…) : chaque appel sur un
 * modèle portant `communityId` est restreint aux communautés de l'utilisateur,
 * sans que l'appelant ait à penser au filtre.
 *
 * Convention : le client scopé s'appelle `scopedDb` (le garde-fou
 * `community-scope.test.ts` n'accepte un accès direct à un modèle collectif que
 * via ce nom, et exige alors `getScopedPrisma` / `scopedPrisma` dans le fichier).
 *
 * Comportement :
 * - Isolation éteinte (`scope === null`) : transparent, AUCUN changement.
 * - Lectures, `update*`, `delete*`, `upsert`, `count`, `aggregate`, `groupBy` :
 *   le `where` reçoit le filtre `communityIdFilter` (un `OR` jamais vide :
 *   sans communauté, rien n'est visible). Sur les opérations « unique »
 *   (`findUnique`, `update`, `delete`…), le filtre s'ajoute dans `AND` : Prisma
 *   ≥ 5 accepte des filtres non uniques à côté de la clé unique.
 * - Créations : `communityId` est OBLIGATOIRE (scalaire, jamais `community:
 *   {connect}`) et doit appartenir au périmètre (`null` seulement si la
 *   communauté par défaut en fait partie). Aucun défaut silencieux.
 * - Une ligne ne change jamais de communauté : `communityId` / `community`
 *   interdits dans `data` des mises à jour.
 * - Opération inconnue sur un modèle scopé : refusée (fail-closed).
 *
 * Bornes assumées (comme le garde-fou statique) : les `include` / `select`
 * imbriqués et le SQL brut ne sont pas filtrés ; les modèles enfants d'une
 * Session ou d'un Tournoi héritent de la communauté de leur parent, ils ne sont
 * pas scopés ici.
 */

/** Modèles Prisma portant `communityId` (garde : `community-scoped-client.test.ts` ↔ schema.prisma). */
export const COMMUNITY_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "Session", "Tournament", "ChatMessage", "Debt", "GameWishlist", "Roulette", "InstantSession",
  "WeeklyChallenge", "MonthlyRecap", "Season", "GroupAchievement", "GroupSessionStats",
  "GroupGameStat", "GroupActiveWeek",
]);

/**
 * Modèles dont `communityId` est OBLIGATOIRE (PR9) : aucune ligne `null` n'existe,
 * la communauté par défaut y a un vrai identifiant, et Prisma refuse un filtre
 * `communityId: null` sur une colonne requise (garde : `community-scoped-client.test.ts` ↔ schema.prisma).
 */
export const COMMUNITY_REQUIRED_MODELS: ReadonlySet<string> = new Set([
  "GameWishlist", "GroupAchievement", "GroupSessionStats", "GroupGameStat", "GroupActiveWeek",
]);

export class CommunityScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityScopeError";
  }
}

type Row = Record<string, unknown>;
type Args = Record<string, unknown> | undefined;

const FILTERED = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate",
  "groupBy", "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATES = new Set(["update", "updateMany", "updateManyAndReturn"]);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

function checkCreateRow(model: string, row: unknown, scope: IsolationScope): void {
  const data = (row ?? {}) as Row;
  if (data.community !== undefined) {
    throw new CommunityScopeError(`${model} : renseigner \`communityId\` (scalaire), pas la relation \`community\`.`);
  }
  const id = data.communityId;
  if (id === undefined) throw new CommunityScopeError(`${model} : \`communityId\` obligatoire à la création.`);
  const allowed = id === null ? scope.includesDefault : typeof id === "string" && scope.communityIds.includes(id);
  if (!allowed) throw new CommunityScopeError(`${model} : communauté hors du périmètre de l'utilisateur.`);
}

function checkUpdateData(model: string, data: unknown): void {
  const row = (data ?? {}) as Row;
  if (row.communityId !== undefined || row.community !== undefined) {
    throw new CommunityScopeError(`${model} : une ligne ne change pas de communauté.`);
  }
}

function restrict(where: unknown, filter: object): Row {
  const base = (where ?? {}) as Row;
  return { ...base, AND: [...asArray(base.AND), filter] };
}

/** Arguments à transmettre à Prisma (ou une `CommunityScopeError`). Fonction pure, testée sans base. */
export function scopeQueryArgs(model: string, operation: string, args: Args, scope: IsolationScope | null): Args {
  if (scope === null || !COMMUNITY_SCOPED_MODELS.has(model)) return args;
  if (!FILTERED.has(operation) && !CREATES.has(operation)) {
    throw new CommunityScopeError(`${model}.${operation} : opération non prise en charge par le client scopé.`);
  }
  const next: Row = { ...(args ?? {}) };
  if (CREATES.has(operation)) {
    asArray(next.data).forEach((row) => checkCreateRow(model, row, scope));
    return next;
  }
  if (UPDATES.has(operation)) checkUpdateData(model, next.data);
  if (operation === "upsert") {
    checkCreateRow(model, next.create, scope);
    checkUpdateData(model, next.update);
  }
  const filterScope = COMMUNITY_REQUIRED_MODELS.has(model) ? { ...scope, includesDefault: false } : scope;
  next.where = restrict(next.where, communityIdFilter(filterScope));
  return next;
}

/** Client Prisma dont les modèles à `communityId` sont restreints à `scope` (`null` = isolation éteinte). */
export function scopedPrisma(scope: IsolationScope | null) {
  return prisma.$extends({
    name: "community-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeQueryArgs(model, operation, args as Args, scope) as typeof args);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof scopedPrisma>;

/** Client scopé pour `userId` : périmètre relu en base à chaque appel (jamais dans le JWT) ; aucune lecture isolation éteinte. */
export async function getScopedPrisma(userId: string): Promise<ScopedPrisma> {
  return scopedPrisma(await getIsolationScope(userId));
}

/**
 * Client scopé sur la seule communauté « active » de l'utilisateur (chat global,
 * dettes de l'accueil) : voir `resolveActiveCommunityScope`.
 */
export async function getActiveScopedPrisma(userId: string): Promise<ScopedPrisma> {
  return scopedPrisma(await resolveActiveCommunityScope(userId));
}

/**
 * Client scopé sur UNE communauté connue (`null` = communauté par défaut, lignes
 * historiques) : pour les écritures DÉRIVÉES d'une ligne existante (ex. dettes
 * d'une soirée), qui héritent de la communauté de leur parent quel que soit
 * l'état d'appartenance de l'acteur. Transparent si l'isolation est éteinte.
 */
export function scopedPrismaForCommunity(communityId: string | null): ScopedPrisma {
  if (!isCommunityIsolationEnabled()) return scopedPrisma(null);
  return scopedPrisma({ communityIds: communityId === null ? [] : [communityId], includesDefault: communityId === null });
}

/**
 * Valeur de `communityId` à écrire. Isolation éteinte : vide (colonne laissée à
 * `null`, comme avant — même règle que la PR3 pour Session et Tournament) ;
 * allumée : la communauté, que le client scopé exige à la création.
 */
export function withCommunity(communityId: string | null): { communityId?: string | null } {
  return isCommunityIsolationEnabled() ? { communityId } : {};
}

/**
 * Client scopé sur UNE communauté identifiée par son id RÉEL (jamais `null`) :
 * la communauté par défaut y inclut ses lignes historiques `communityId = null`.
 * Pour les calculs qui portent sur une communauté entière (trophées de groupe).
 */
export async function scopedPrismaForCommunityId(communityId: string): Promise<ScopedPrisma> {
  if (!isCommunityIsolationEnabled()) return scopedPrisma(null);
  const defaultId = await getDefaultCommunityId();
  return scopedPrisma({ communityIds: [communityId], includesDefault: communityId === defaultId });
}
