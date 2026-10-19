export const SESSION_GALLERY_MAX_BYTES = 4 * 1024 * 1024;
export const SESSION_GALLERY_MAX_ITEMS = 8;
export const SESSION_GALLERY_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"] as const;
export type SessionGalleryMime = (typeof SESSION_GALLERY_MIMES)[number];

export function isSessionVideoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SESSION_VIDEO_ENABLED === "true";
}

const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "dash", "M4V ", "MSNV", "F4V ", "F4P "]);

export function detectSessionGalleryMime(bytes: Uint8Array, fileSize = bytes.length): SessionGalleryMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 16) {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const boxType = String.fromCharCode(...bytes.subarray(4, 8));
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (boxType === "ftyp" && boxSize >= 16 && boxSize <= fileSize && MP4_BRANDS.has(brand)) return "video/mp4";
  }
  return null;
}

export function parseSessionGalleryRange(value: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
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
  const results = await Promise.allSettled(pathnames.map((pathname) => del(pathname, { token })));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) logger.warn("session-gallery", "Private Blob cleanup left orphaned files.", { failed, total: pathnames.length });
}
