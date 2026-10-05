import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { isCommunityIsolationEnabled, listCronCommunityIds } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { prisma } from "@/lib/prisma";
import { wallClockNow, endOfMonthUTC } from "@/lib/wallclock";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { logger } from "@/lib/logger";

/**
 * Sprint 4 (FEATURE 3, Saisons mensuelles) — reset mensuel du classement
 * XP. Une seule saison `isActive` par communauté à la fois (invariant applicatif). Voir
 * le commentaire sur `Season` (prisma/schema.prisma) pour le contexte
 * complet.
 */
export async function getActiveSeason(communityId?: string) {
  const id = communityId ?? await getDefaultCommunityId();
  const scopedDb = await scopedPrismaForCommunityId(id);
  return scopedDb.season.findFirst({ where: { communityId: id, isActive: true } });
}

/** Pure — numéro de la prochaine saison à créer, extrait pour rester testable sans Prisma. `null` = aucune saison n'a jamais existé (tout premier bootstrap). */
export function nextSeasonNumber(currentMaxNumber: number | null): number {
  return (currentMaxNumber ?? 0) + 1;
}

/**
 * Pure — classe des users par XP décroissant et assigne les positions
 * (1-indexées). Extrait pour rester testable sans Prisma (PR "Fiabilise la
 * clôture des saisons").
 *
 * Utilisé avec des valeurs déjà lues sous verrou (`SELECT ... FOR UPDATE`,
 * voir `finalizeSeasonIfDue`) — jamais avec un `ORDER BY` SQL : sous
 * `FOR UPDATE`, une ligne pour laquelle il a fallu attendre un verrou
 * concurrent est retournée dans sa version la plus récente, mais l'
 * `ORDER BY` SQL a été évalué AVANT cette attente — le tri SQL peut donc ne
 * plus correspondre aux valeurs réellement renvoyées. Trier ici, après
 * coup, sur les valeurs effectives élimine ce risque.
 *
 * Égalités : `Array.prototype.sort` est stable (garanti par le spec
 * ECMAScript) — deux users à XP égal gardent leur ordre relatif d'entrée,
 * qui reste non spécifié (aucune clé de tri secondaire), exactement comme
 * le `ORDER BY xpTotal DESC` sans clé secondaire qu'il remplace. Chacun
 * reçoit malgré tout une position strictement croissante (jamais deux users
 * à la position 1).
 */
export function rankUsersByXp<T extends { xpTotal: number }>(
  users: T[]
): (T & { position: number })[] {
  return [...users]
    .sort((a, b) => b.xpTotal - a.xpTotal)
    .map((u, i) => ({ ...u, position: i + 1 }));
}

/** Aucun user en base au moment de la clôture — annule tout (voir `finalizeSeasonIfDue`), pas une vraie erreur. */
class NoUsersToCloseSeasonError extends Error {}

/**
 * Garde-fou idempotent qui garantit une saison active — appelé à la
 * volée (Home, cron `close-sessions`) : ne coûte qu'un `findFirst` tant
 * qu'une saison active existe déjà (99.9% des appels), et répare l'état
 * sinon.
 *
 * Renommée depuis `ensureFirstSeasonExists` (PR "Atomicité saisons +
 * tournois") — corrige un bug remonté à la reconnaissance : l'ancienne
 * version recréait TOUJOURS "Saison 1" en dur dès qu'aucune saison
 * n'était active, quelle qu'en soit la cause. Ça fonctionnait pour le
 * tout premier bootstrap (base vierge), mais échouait silencieusement
 * pour toute autre cause survenant APRÈS qu'un vrai cycle de saisons ait
 * commencé (ex. un crash entre la clôture d'une saison et la création de
 * la suivante — désormais structurellement impossible grâce à la
 * transaction de `finalizeSeasonIfDue` ci-dessous, mais ce garde-fou
 * reste la seule protection pour toute AUTRE cause, ex. une suppression
 * accidentelle en base) : `number: 1` percutait la contrainte unique
 * `Season(communityId, number)` dès qu'une vraie saison 1 existait déjà dans
 * l'historique, l'erreur était catchée silencieusement par le
 * `isUniqueConstraintViolation` ci-dessous, et l'app restait SANS
 * saison active indéfiniment.
 *
 * Calcule maintenant le bon numéro à reprendre (`nextSeasonNumber`, MAX
 * existant + 1) au lieu de le hardcoder — fonctionne aussi bien pour le
 * tout premier bootstrap (`MAX` = `null` → 1) que pour une réparation en
 * plein cycle.
 *
 * Idempotent par construction : `getActiveSeason()` retrouve la saison
 * dès qu'une existe, et la contrainte unique sur `Season(communityId, number)` empêche
 * une double création en cas d'appels concurrents (retombe
 * silencieusement, même filet de sécurité que `unlockBadge`) — désormais
 * sur le bon numéro dans tous les cas, donc un appel concurrent retombe
 * proprement au lieu de rester bloqué.
 */
export async function ensureActiveSeasonExists(communityId?: string): Promise<void> {
  const id = communityId ?? await getDefaultCommunityId();
  const scopedDb = await scopedPrismaForCommunityId(id);
  const active = await getActiveSeason(id);
  if (active) return;

  const lastSeason = await scopedDb.season.findFirst({ where: { communityId: id }, orderBy: { number: "desc" } });
  const number = nextSeasonNumber(lastSeason?.number ?? null);

  const now = wallClockNow();
  try {
    await scopedDb.season.create({
      data: {
        communityId: id,
        number,
        name: `Saison ${number}`,
        startDate: now,
        endDate: endOfMonthUTC(now),
        isActive: true,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return;
    throw error;
  }
}

/**
 * Clôture la saison active si sa `endDate` est dépassée : snapshot du
 * classement (`SeasonSnapshot`, AVANT le reset — seule façon de consulter
 * "qui était où" une fois l'XP remis à zéro), reset `xpTotal` à 0 pour
 * TOUT LE MONDE (badges/achievements/streak jamais touchés — cf. spec
 * "conservés"), puis ouverture immédiate de la saison suivante (jamais de
 * trou sans saison active) — annonce Discord du champion après coup.
 *
 * Fix bug remonté (atomicité saisons, PR "Atomicité saisons + tournois")
 * — ces 4 écritures vivent maintenant dans UNE seule transaction, ouverte
 * par un claim atomique (`updateMany` conditionné sur `isActive: true`,
 * même pattern que `claimSessionClose`, `src/lib/sessions.ts`). Avant ce
 * fix : un crash entre le reset XP et la création de la nouvelle saison
 * laissait l'app SANS AUCUNE saison active — `ensureActiveSeasonExists`
 * ne savait pas réparer ce cas précis avant son propre fix ci-dessus
 * (elle retombait toujours sur `number: 1`, en conflit avec l'historique
 * réel). Un crash APRÈS les snapshots mais AVANT l'ancienne transaction
 * partielle faisait aussi replanter le cron TOUS LES JOURS sur la
 * contrainte unique `SeasonSnapshot(seasonId, userId)` en retentant un
 * `createMany` déjà à moitié appliqué. Désormais, un crash en cours de
 * transaction annule TOUT (y compris les snapshots) : un rejeu repart
 * toujours d'un état propre, plus de boucle de replantage possible.
 *
 * Le claim lui-même (`isActive: true → false`) rend une double exécution
 * concurrente du cron inoffensive : la 2e trouve `count !== 1` et
 * s'arrête sans rien lire ni recalculer.
 *
 * Fix bug remonté (perte d'XP concurrente, PR "Fiabilise la clôture des
 * saisons") — la lecture des users pour le snapshot vivait AVANT cette
 * transaction (`prisma.user.findMany`, sans verrou). Tout `awardXp()`
 * (`src/lib/xp-actions.ts`) ou `placeBet()` (`src/lib/xp-bets.ts`) qui
 * commitait entre cette lecture et le `updateMany({xpTotal:0})` plus bas
 * était absent du snapshot ET silencieusement écrasé par le reset — XP
 * perdue sans trace. Désormais, `SELECT ... FOR UPDATE` verrouille TOUTES
 * les lignes `User` dès l'intérieur de la transaction, juste après le
 * claim : tout writer concurrent visant ces lignes (`awardXp`, `placeBet`)
 * attend le commit de CETTE transaction avant d'écrire, et s'applique
 * ensuite proprement sur le solde déjà remis à 0 (attribué à la saison
 * suivante — jamais perdu). Voir `placeBet` (`src/lib/xp-bets.ts`) pour la
 * revérification symétrique côté paris (empêche un solde négatif dans le
 * sens inverse).
 *
 * Limite résiduelle documentée, volontairement non traitée dans cette PR
 * ciblée : un compte Discord créé PENDANT cette transaction (entre le
 * `SELECT ... FOR UPDATE` ci-dessous et le `updateMany` du reset) n'est
 * verrouillé par aucun des deux, puisqu'il n'existait pas encore au moment
 * du `SELECT`. Si ce nouveau user gagne de l'XP dans cette fenêtre précise
 * (ex. badge "premstate connexion" avec `xpReward`, débloqué dès son tout
 * premier `getCurrentUser()` via `checkTemporalBadges` — vérifié dans
 * `src/lib/badges.ts`), cette XP pourrait être perdue par le même
 * mécanisme que le bug corrigé ci-dessus, mais pour une ligne que notre
 * verrou n'a jamais vue. Fenêtre extrêmement étroite (nouvelle inscription
 * ET gain d'XP simultanés, pile pendant l'exécution — quelques dizaines de
 * ms — d'un cron mensuel), jugée négligeable pour la taille de ce groupe,
 * mais réelle : une correction complète nécessiterait de verrouiller la
 * table entière contre les INSERT concurrents (`LOCK TABLE`), hors
 * périmètre de cette PR.
 *
 * Appelée depuis le cron `monthly-tasks` (quotidien) — pas de
 * vérification "déjà traité aujourd'hui" nécessaire : une fois `endDate`
 * dépassée, la saison est immédiatement remplacée par une nouvelle dont
 * `endDate` est dans le futur, donc un second appel le même jour ne
 * retrouve plus rien à clôturer (idempotent par construction, pas besoin
 * d'un flag dédié).
 */
export async function finalizeSeasonIfDue(): Promise<void> {
  // PR B fournira les soldes par communauté. Aucun reset global sous isolation :
  // un membre de A+B ne doit jamais perdre son XP de B lors de la clôture de A.
  if (isCommunityIsolationEnabled()) {
    logger.warn("seasons", "Clôture suspendue sous isolation en attendant les soldes XP par communauté (PR B).");
    return;
  }
  const season = await getActiveSeason();
  if (!season) return; // Bootstrapée par ensureActiveSeasonExists (ci-dessus) ou seedInitialSeason (src/lib/seed-season.ts).
  if (wallClockNow() < season.endDate) return;

  const now = wallClockNow();
  const nextNumber = season.number + 1;

  type FinalizeOutcome =
    | { claimed: false }
    | { claimed: true; champion: { discordId: string; discordName: string; xpTotal: number } };

  let outcome: FinalizeOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<FinalizeOutcome> => {
      const claim = await tx.season.updateMany({
        where: { id: season.id, isActive: true },
        data: { isActive: false },
      });
      if (claim.count !== 1) return { claimed: false }; // déjà clôturée par une exécution concurrente

      const lockedUsers = await tx.$queryRaw<
        { id: string; discordId: string; discordName: string; xpTotal: number }[]
      >`SELECT id, "discordId", "discordName", "xpTotal" FROM "User" FOR UPDATE`;

      if (lockedUsers.length === 0) {
        // Comportement identique à avant ce fix : rien à clôturer tant
        // qu'il n'y a aucun user — annule TOUT y compris le claim
        // ci-dessus (la saison reste active, le cron réessaiera demain).
        throw new NoUsersToCloseSeasonError();
      }

      const ranked = rankUsersByXp(lockedUsers);
      const snapshotRows = ranked.map((u) => {
        const level = levelForXp(u.xpTotal);
        return {
          seasonId: season.id,
          userId: u.id,
          xp: u.xpTotal,
          level,
          rank: rankForLevel(level).name,
          position: u.position,
        };
      });
      const champion = ranked[0];

      await tx.seasonSnapshot.createMany({ data: snapshotRows });
      await tx.user.updateMany({ data: { xpTotal: 0 } });
      await tx.season.create({
        data: {
          communityId: season.communityId,
          number: nextNumber,
          name: `Saison ${nextNumber}`,
          startDate: now,
          endDate: endOfMonthUTC(now),
          isActive: true,
        },
      });

      return { claimed: true, champion };
    });
  } catch (error) {
    if (error instanceof NoUsersToCloseSeasonError) return;
    throw error;
  }

  if (!outcome.claimed) return;

  const result = await postToDiscord({
    title: `🏆 ${season.name} terminée !`,
    description: `Champion : <@${outcome.champion.discordId}> avec ${outcome.champion.xpTotal} XP !\nL'XP de tout le monde repart à 0 — nouvelle saison lancée.`,
    color: ACCENT_COLOR,
  });
  if (!result.ok) {
    logger.warn("seasons", "Notif Discord fin de saison non envoyée.", { seasonId: season.id });
  }
}

/** Home — "Saison X — Jour Y/30" avec barre de progression. `null` si aucune saison active (ne devrait pas arriver post-bootstrap). */
export async function getSeasonProgress(viewerId: string): Promise<{
  number: number;
  name: string;
  dayOfMonth: number;
  totalDays: number;
} | null> {
  const communityId = await writeCommunityIdForUser(viewerId);
  if (communityId === null) return null;
  const season = await getActiveSeason(communityId);
  if (!season) return null;

  const now = wallClockNow();
  const dayOfMonth = now.getUTCDate();
  const totalDays = endOfMonthUTC(now).getUTCDate();

  return { number: season.number, name: season.name, dayOfMonth, totalDays };
}

export async function ensureActiveSeasonExistsForViewer(viewerId: string): Promise<void> {
  const communityId = await writeCommunityIdForUser(viewerId);
  if (communityId !== null) await ensureActiveSeasonExists(communityId);
}

export async function ensureActiveSeasonsExist(): Promise<void> {
  for (const communityId of await listCronCommunityIds()) await ensureActiveSeasonExists(communityId);
}
