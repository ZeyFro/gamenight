export const SESSION_GALLERY_MAX_BYTES = 4 * 1024 * 1024;
export const SESSION_GALLERY_MAX_ITEMS = 8;
export const SESSION_GALLERY_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type SessionGalleryMime = (typeof SESSION_GALLERY_MIMES)[number];

export function detectSessionGalleryMime(bytes: Uint8Array): SessionGalleryMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export function isSessionGalleryConsent(value: unknown): boolean {
  return value === "on";
}
import { del } from "@vercel/blob";
import { logger } from "@/lib/logger";


export async function deleteSessionGalleryBlobs(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  const token = process.env.SESSION_MEDIA_BLOB_TOKEN;
  if (!token) {
    logger.warn("session-gallery", "Private Blob cleanup skipped because its token is unavailable.", { count: pathnames.length });
    return;
  }
  const results = await Promise.allSettled(pathnames.map((pathname) => del(pathname, { access: "private", token })));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) logger.warn("session-gallery", "Private Blob cleanup left orphaned files.", { failed, total: pathnames.length });
}
