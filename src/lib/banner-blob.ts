import { head as blobHead, del as blobDel } from "@vercel/blob";
import { logger } from "@/lib/logger";

/**
 * Durcissement des bannières de profil (PR "Durcissement des bannières") —
 * deux responsabilités pures + une orchestration best-effort :
 *
 * 1. Détection du format réel d'un fichier par signature ("magic bytes"),
 *    jamais par `file.type` (déclaré par le navigateur, falsifiable).
 * 2. Décision — pure, sans appel réseau — de si un ancien blob PEUT être
 *    supprimé : jamais une URL externe, jamais le blob d'un autre user.
 * 3. Suppression best-effort de l'ancien blob, seulement après confirmation
 *    de propriété par le SDK (`head()`, authentifié par notre propre
 *    `BLOB_READ_WRITE_TOKEN`).
 */

export type BannerImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export const BANNER_MIME_TO_EXT: Record<BannerImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Détecte le format réel d'un fichier à partir de ses premiers octets
 * (signatures documentées : JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`,
 * GIF `47 49 46 38 (37|39) 61`, WebP `RIFF….WEBP`). Lecture seule — ne
 * modifie jamais le buffer passé, ne décode ni ne réencode rien : un GIF
 * reste byte pour byte le fichier original, y compris son animation.
 *
 * `null` si aucune signature connue ne correspond (fichier corrompu, autre
 * format, ou tentative de déguiser un fichier non-image en image).
 */
export function detectBannerImageSignature(bytes: Uint8Array): BannerImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Namespace des nouveaux uploads : `banners/{userId}/...`. Choisi plutôt
 * que de réutiliser/parser l'ancien format `banners/{userId}-{ts}.ext`
 * (qui contient techniquement l'id mais sans séparateur fiable) — un
 * préfixe de dossier explicite est sans ambiguïté à vérifier après coup.
 */
export function buildBannerBlobPathname(userId: string, extension: string): string {
  return `banners/${userId}/${Date.now()}.${extension}`;
}

/**
 * `true` seulement si l'URL a le hostname des blobs publics Vercel Blob.
 * Vérification bon marché, sans appel réseau — élimine déjà toute URL
 * externe (klipy.com, imgur, etc.) avant même d'envisager une suppression.
 * Ne prouve PAS l'appartenance à NOTRE store (voir `head()` plus bas), ni
 * a fortiori à un user précis (voir `isUserOwnedBannerPathname`).
 */
export function isOwnBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** `null` si l'URL est invalide. Le pathname exclut le `/` de tête. */
export function extractBlobPathname(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

/**
 * Un `head()` réussi prouve que le blob appartient à NOTRE store Vercel
 * Blob (authentifié par `BLOB_READ_WRITE_TOKEN`, cf. doc du module) — mais
 * pas qu'il appartient à CET utilisateur : rien n'empêcherait un membre de
 * coller comme "URL externe" la bannière Blob d'un autre membre du même
 * store, ni que ce raccourci provoque ensuite sa suppression. D'où ce
 * second contrôle, sur le pathname namespacé (`banners/{userId}/...`).
 */
export function isUserOwnedBannerPathname(pathname: string | null, userId: string): boolean {
  return pathname !== null && pathname.startsWith(`banners/${userId}/`);
}

/**
 * Décision PURE (aucun appel réseau) : ce blob peut-il être candidat à la
 * suppression pour cet utilisateur ? Combine les deux contrôles ci-dessus.
 * `false` pour toute URL externe, tout blob d'un autre user, et tout
 * ancien blob au format pré-namespace (délibérément laissé orphelin —
 * préférable à un risque de suppression côté mauvais utilisateur, cf.
 * docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md).
 */
export function canDeleteBannerBlob(url: string, userId: string): boolean {
  if (!isOwnBlobUrl(url)) return false;
  return isUserOwnedBannerPathname(extractBlobPathname(url), userId);
}

/**
 * `true` seulement si un ancien blob existe, diffère de la nouvelle valeur,
 * et est un candidat sûr (`canDeleteBannerBlob`). Couvre à la fois le cas
 * "on vide la bannière" (`newUrl: ""`) et "on repasse sur la même URL"
 * (aucune suppression, évidemment).
 */
export function shouldDeleteOldBanner(
  oldUrl: string | null,
  newUrl: string,
  userId: string
): boolean {
  if (!oldUrl) return false;
  if (oldUrl === newUrl) return false;
  return canDeleteBannerBlob(oldUrl, userId);
}

export interface BannerBlobOps {
  head: typeof blobHead;
  del: typeof blobDel;
}

const defaultBannerBlobOps: BannerBlobOps = { head: blobHead, del: blobDel };

/**
 * Suppression best-effort de l'ancien blob — appelée APRÈS que la nouvelle
 * valeur a été commitée en base (jamais avant : voir les deux appelants).
 * Le `head()` est la preuve d'appartenance à notre store (cf. doc
 * `isUserOwnedBannerPathname`) ; un échec (blob déjà supprimé, pas à
 * nous…) ou celui du `del()` qui suit ne remonte jamais à l'appelant — la
 * bannière déjà mise à jour en base ne doit jamais dépendre du nettoyage
 * de l'ancienne. `ops` injectable pour les tests (jamais d'appel Blob réel
 * en dehors de la valeur par défaut).
 */
export async function safelyDeleteOldBannerBlob(
  oldUrl: string | null,
  newUrl: string,
  userId: string,
  ops: BannerBlobOps = defaultBannerBlobOps
): Promise<void> {
  if (!shouldDeleteOldBanner(oldUrl, newUrl, userId)) return;
  try {
    await ops.head(oldUrl as string);
    await ops.del(oldUrl as string);
  } catch (error) {
    logger.error("banner-blob", error, { userId });
  }
}

/**
 * Nettoyage best-effort du blob qu'on vient tout juste de créer, quand la
 * mise à jour Prisma qui devait le référencer échoue juste après — évite
 * l'orphelin. Certitude de propriété maximale (on vient de le créer
 * nous-mêmes) : suppression directe, sans repasser par
 * `canDeleteBannerBlob`.
 */
export async function cleanupOrphanedBannerUpload(
  newBlobUrl: string,
  ops: Pick<BannerBlobOps, "del"> = defaultBannerBlobOps
): Promise<void> {
  try {
    await ops.del(newBlobUrl);
  } catch (error) {
    logger.error("banner-blob", error);
  }
}
