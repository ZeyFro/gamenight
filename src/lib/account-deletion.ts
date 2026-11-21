import { del, list } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { canDeleteBannerBlob, isOwnBlobUrl } from "@/lib/banner-blob";
import {
  ANONYMOUS_NAME,
  JSON_SCRUB_COLUMNS,
  TEXT_SCRUB_COLUMNS,
  isTombstoneDiscordId,
  modelAccessor,
  nonFkEntries,
  planEntries,
  scrubJsonValue,
  scrubNeedles,
  tombstoneDiscordId,
  tombstoneUserData,
} from "@/lib/account-deletion-plan";

/**
 * Suppression de compte (ACCOUNT_DELETION_ENABLED, docs/SUPPRESSION_COMPTE.md) : exécuteur du classement
 * `account-deletion-plan.ts`. Module de la liste SCOPED_MODULES de `community-scope.test.ts` : chaque accès à un
 * modèle collectif est filtré par l'identifiant de LA personne (jamais par communauté, ses données traversent
 * les communautés) et ne touche aucune ligne d'un autre membre, hors neutralisation de son pseudo dans le texte
 * d'autres lignes. Aucun appel Discord : les messages déjà publiés restent hors de contrôle de l'application.
 *
 * Ordre : (1) refus si dernier OWNER, (2) fichiers Blob (échec = refus, rien n'a changé en base), (3) une seule
 * transaction : livraisons, données personnelles, neutralisation des textes, anonymisation de la ligne User,
 * journal. Un échec de transaction annule tout ; relancer est sans danger.
 */

/** Remplace un texte effacé là où une contrainte de base impose une valeur (défi soumis = preuve non nulle). */
const ERASED_TEXT = "[supprimé]";

export type AccountDeletionResult =
  | { status: "deleted"; summary: Record<string, number> }
  | { status: "refused"; reason: "last_owner"; communities: string[] }
  | { status: "not_found" }
  | { status: "already_deleted" };

/** Fichiers Blob de la personne, injectables pour les tests (aucun appel réseau en test). */
export interface AccountBlobOps {
  /** URLs des blobs du store public sous `prefix`. */
  listPublicUrls(prefix: string): Promise<string[]>;
  deletePublic(urls: string[]): Promise<void>;
  /** Médias de galerie (store privé, jeton `SESSION_MEDIA_BLOB_TOKEN`). */
  deletePrivate(pathnames: string[]): Promise<void>;
}

export class AccountBlobUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountBlobUnavailableError";
  }
}

export const defaultAccountBlobOps: AccountBlobOps = {
  async listPublicUrls(prefix) {
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      urls.push(...page.blobs.map((blob) => blob.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return urls;
  },
  async deletePublic(urls) {
    if (urls.length > 0) await del(urls);
  },
  async deletePrivate(pathnames) {
    if (pathnames.length === 0) return;
    const token = process.env.SESSION_MEDIA_BLOB_TOKEN;
    if (!token) throw new AccountBlobUnavailableError("SESSION_MEDIA_BLOB_TOKEN absent : les médias de galerie ne peuvent pas être supprimés.");
    await del(pathnames, { token });
  },
};

type DeleteManyDelegate = { deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> };

function delegateOf(tx: Prisma.TransactionClient, model: string): DeleteManyDelegate {
  const delegate = (tx as unknown as Record<string, DeleteManyDelegate | undefined>)[modelAccessor(model)];
  if (!delegate || typeof delegate.deleteMany !== "function") throw new Error(`Modèle Prisma introuvable pour la suppression de compte : ${model}`);
  return delegate;
}

/** Communautés où la personne est le dernier OWNER ACTIF (une communauté sans propriétaire est refusée). */
async function soleOwnerCommunities(db: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const owned = await db.membership.findMany({
    where: { userId, role: "OWNER", status: "ACTIVE" },
    select: { communityId: true, community: { select: { name: true } } },
  });
  const sole: string[] = [];
  for (const membership of owned) {
    const others = await db.membership.count({
      where: { communityId: membership.communityId, role: "OWNER", status: "ACTIVE", userId: { not: userId } },
    });
    if (others === 0) sole.push(membership.community.name);
  }
  return sole;
}

/** Fichiers Blob à supprimer : bannière publique (et ses anciennes versions) et médias de galerie privés. */
async function collectBlobs(user: { id: string; bannerUrl: string | null }, ops: AccountBlobOps): Promise<{ publicUrls: string[]; privatePaths: string[] }> {
  const privatePaths = (await prisma.sessionGalleryMedia.findMany({ where: { uploadedById: user.id }, select: { pathname: true } })).map((media) => media.pathname);
  const publicUrls = new Set<string>();
  if (user.bannerUrl && isOwnBlobUrl(user.bannerUrl)) {
    // `banners/{id}/…` (actuel) et `banners/{id}-…` (ancien format) : le préfixe couvre les deux, y compris les orphelins.
    for (const url of await ops.listPublicUrls(`banners/${user.id}`)) publicUrls.add(url);
    if (canDeleteBannerBlob(user.bannerUrl, user.id)) publicUrls.add(user.bannerUrl);
  }
  return { publicUrls: [...publicUrls], privatePaths };
}

export async function deleteAccount(
  userId: string,
  options: { blobOps?: AccountBlobOps; now?: Date } = {}
): Promise<AccountDeletionResult> {
  const blobOps = options.blobOps ?? defaultAccountBlobOps;
  const now = options.now ?? new Date();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, discordId: true, discordName: true, bannerUrl: true } });
  if (!user) return { status: "not_found" };
  if (isTombstoneDiscordId(user.discordId)) return { status: "already_deleted" };

  const preCheck = await soleOwnerCommunities(prisma, user.id);
  if (preCheck.length > 0) return { status: "refused", reason: "last_owner", communities: preCheck };

  // Migration du journal absente : l'erreur Prisma remonte ICI, avant toute suppression de fichier.
  await prisma.accountDeletionLog.findFirst({ select: { id: true } });

  // Fichiers d'abord : un échec ici laisse la base intacte (la personne peut réessayer). Les fichiers déjà supprimés
  // ne gênent pas une nouvelle tentative.
  const blobs = await collectBlobs(user, blobOps);
  await blobOps.deletePublic(blobs.publicUrls);
  await blobOps.deletePrivate(blobs.privatePaths);

  const needles = scrubNeedles(user);
  const tombstoneId = tombstoneDiscordId(user.id);

  const summary = await prisma.$transaction(
    async (tx) => {
      const counts: Record<string, number> = {};
      const add = (key: string, count: number) => {
        if (count > 0) counts[key] = (counts[key] ?? 0) + count;
      };

      // Verrou des communautés où la personne est OWNER, puis contrôle autoritaire (deux OWNER qui se suppriment en même temps).
      const ownerRows = await tx.membership.findMany({ where: { userId: user.id, role: "OWNER", status: "ACTIVE" }, select: { communityId: true } });
      if (ownerRows.length > 0) {
        await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id" IN (${Prisma.join(ownerRows.map((row) => row.communityId))}) FOR UPDATE`;
        const sole = await soleOwnerCommunities(tx, user.id);
        if (sole.length > 0) throw new RefusedLastOwner(sole);
      }

      // Livraisons Discord en file ou passées vers la personne (identifiants de MP), jamais envoyées au compte anonymisé.
      add("NotificationDelivery.recipientKey", (await tx.notificationDelivery.deleteMany({ where: { recipientKey: `user:${user.id}` } })).count);

      // Champs-identifiants sans clé étrangère.
      for (const { model, field } of nonFkEntries("DELETE")) {
        add(`${model}.${field}`, (await delegateOf(tx, model).deleteMany({ where: { [field]: user.id } })).count);
      }

      // Défis Tower : solo = supprimés (preuves, votes, recours) ; partagés avec d'autres participants = conservés, preuve effacée.
      const attempts = await tx.towerChallengeAttempt.findMany({
        where: { userId: user.id },
        select: { id: true, participants: { where: { userId: { not: user.id } }, select: { userId: true }, take: 1 } },
      });
      const soloIds = attempts.filter((attempt) => attempt.participants.length === 0).map((attempt) => attempt.id);
      const sharedIds = attempts.filter((attempt) => attempt.participants.length > 0).map((attempt) => attempt.id);
      add("TowerChallengeAppeal.attemptId", (await tx.towerChallengeAppeal.deleteMany({ where: { attemptId: { in: soloIds } } })).count);
      add("TowerChallengeAttempt.userId", (await tx.towerChallengeAttempt.deleteMany({ where: { id: { in: soloIds } } })).count);
      add(
        "TowerChallengeAttempt.proof",
        (await tx.towerChallengeAttempt.updateMany({ where: { id: { in: sharedIds }, proofText: { not: null } }, data: { proofText: ERASED_TEXT, proofCode: null } })).count
      );
      add(
        "TowerChallengeAttempt.doubtReportedByUserId",
        (await tx.towerChallengeAttempt.updateMany({ where: { doubtReportedByUserId: user.id }, data: { doubtReportedByUserId: null } })).count
      );

      // Relations vers User supprimées (données personnelles).
      for (const { model, field } of planEntries("DELETE")) {
        add(`${model}.${field}`, (await delegateOf(tx, model).deleteMany({ where: { [field]: user.id } })).count);
      }

      // Signalements, demandes de rôle, installations de bot : l'identifiant Discord brut est remplacé par un jeton neutre.
      add(
        "ModerationReport.author",
        await tx.$executeRaw`UPDATE "ModerationReport" SET "excerpt" = '[supprimé]', "authorDiscordId" = ${tombstoneId} WHERE "authorDiscordId" = ${user.discordId}`
      );
      add("ModerationReport.reporter", await tx.$executeRaw`UPDATE "ModerationReport" SET "reporterDiscordId" = ${tombstoneId} WHERE "reporterDiscordId" = ${user.discordId}`);
      add("DiscordRoleRequest.requester", await tx.$executeRaw`UPDATE "DiscordRoleRequest" SET "requesterDiscordId" = ${tombstoneId} WHERE "requesterDiscordId" = ${user.discordId}`);
      add("Community.installedByDiscordId", await tx.$executeRaw`UPDATE "Community" SET "installedByDiscordId" = NULL WHERE "installedByDiscordId" = ${user.discordId}`);
      add("XpAdjustment.userName", await tx.$executeRaw`UPDATE "XpAdjustment" SET "userName" = ${ANONYMOUS_NAME} WHERE "userId" = ${user.id}`);
      add("XpAdjustment.adminName", await tx.$executeRaw`UPDATE "XpAdjustment" SET "adminName" = ${ANONYMOUS_NAME} WHERE "adminId" = ${user.id}`);

      // Pseudo et identifiant Discord cités dans les textes d'AUTRES lignes (notifications reçues par d'autres membres, etc.).
      for (const { table, columns } of TEXT_SCRUB_COLUMNS) {
        for (const column of columns) {
          for (const needle of needles) {
            const count = await tx.$executeRaw`UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.raw(`"${column}"`)} = replace(${Prisma.raw(`"${column}"`)}, ${needle}, ${ANONYMOUS_NAME}) WHERE position(${needle} in ${Prisma.raw(`"${column}"`)}) > 0`;
            add(`${table}.${column}`, count);
          }
        }
      }
      for (const { table, column } of JSON_SCRUB_COLUMNS) {
        const col = Prisma.raw(`"${column}"`);
        const tbl = Prisma.raw(`"${table}"`);
        for (const needle of needles) {
          const escaped = JSON.stringify(needle).slice(1, -1);
          const rows = await tx.$queryRaw<Array<{ id: string; value: unknown }>>`SELECT "id", ${col} AS "value" FROM ${tbl} WHERE position(${escaped} in ${col}::text) > 0`;
          for (const row of rows) {
            const { value, changed } = scrubJsonValue(row.value, needles, ANONYMOUS_NAME);
            if (!changed) continue;
            await tx.$executeRaw`UPDATE ${tbl} SET ${col} = ${JSON.stringify(value)}::jsonb WHERE "id" = ${row.id}`;
            add(`${table}.${column}`, 1);
          }
        }
      }

      // La ligne User devient un compte anonymisé : jamais supprimée (les contenus collectifs conservés la référencent).
      await tx.user.update({ where: { id: user.id }, data: tombstoneUserData(user.id, now) });

      await tx.accountDeletionLog.create({ data: { userId: user.id, summary: counts } });
      return counts;
    },
    { timeout: 60_000, maxWait: 10_000 }
  ).catch((error: unknown) => {
    if (error instanceof RefusedLastOwner) return error;
    throw error;
  });

  if (summary instanceof RefusedLastOwner) return { status: "refused", reason: "last_owner", communities: summary.communities };
  logger.info("account-deletion", "Account anonymized.", { userId: user.id, tables: Object.keys(summary).length });
  return { status: "deleted", summary };
}

class RefusedLastOwner extends Error {
  constructor(readonly communities: string[]) {
    super("last_owner");
  }
}
