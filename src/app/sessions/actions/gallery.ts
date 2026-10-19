"use server";

import { del, put } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSessionAccessRole } from "@/lib/session-access";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import {
  detectSessionGalleryMime,
  isSessionVideoEnabled,
  isSessionGalleryConsent,
  SESSION_GALLERY_MAX_BYTES,
  SESSION_GALLERY_MAX_ITEMS,
} from "@/lib/session-gallery";

const token = () => process.env.SESSION_MEDIA_BLOB_TOKEN;

export async function uploadSessionGalleryImageAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const sessionId = formData.get("sessionId");
  const file = formData.get("media");
  if (typeof sessionId !== "string" || !sessionId || !(file instanceof File) || file.size === 0) return;
  if (!isSessionGalleryConsent(formData.get("consent"))) return;
  const blobToken = token();
  if (!blobToken || !checkRateLimit(user.id, "uploadSessionGalleryImage", { limit: 3 })) {
    redirect(`/sessions/${sessionId}?gallery=indisponible`);
  }
  if (file.size > SESSION_GALLERY_MAX_BYTES) redirect(`/sessions/${sessionId}?gallery=trop-lourd`);
  if ((await getSessionAccessRole(user.id, sessionId)) !== "creator") redirect("/sessions");

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session?.communityId) redirect(`/sessions/${sessionId}?gallery=desactive`);
  const communityId = await statsCommunityIdForSession(session.communityId);
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { sessionGalleryEnabled: true } });
  if (!community?.sessionGalleryEnabled) redirect(`/sessions/${sessionId}?gallery=desactive`);
  if (await prisma.sessionGalleryMedia.count({ where: { sessionId } }) >= SESSION_GALLERY_MAX_ITEMS) {
    redirect(`/sessions/${sessionId}?gallery=pleine`);
  }

  const mimeType = detectSessionGalleryMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.size);
  if (!mimeType) redirect(`/sessions/${sessionId}?gallery=format`);
  if (mimeType === "video/mp4" && !isSessionVideoEnabled()) redirect(`/sessions/${sessionId}?gallery=video-desactive`);
  const pathname = `sessions/${sessionId}/${crypto.randomUUID()}`;
  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put(pathname, file, {
      access: "private",
      token: blobToken,
      contentType: mimeType,
      addRandomSuffix: false,
    });
  } catch {
    redirect(`/sessions/${sessionId}?gallery=indisponible`);
  }
  try {
    await prisma.sessionGalleryMedia.create({
      data: { sessionId, uploadedById: user.id, pathname: blob.pathname, mimeType, sizeBytes: file.size },
    });
  } catch {
    // shortcut: Blob cleanup is best-effort after a database outage; add a cleanup queue if orphan volume grows.
    await del(blob.pathname, { token: blobToken }).catch(() => undefined);
    redirect(`/sessions/${sessionId}?gallery=echec`);
  }
  revalidatePath(`/sessions/${sessionId}`);
  redirect(`/sessions/${sessionId}?gallery=ok`);
}

export async function deleteSessionGalleryImageAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const sessionId = formData.get("sessionId");
  const mediaId = formData.get("mediaId");
  if (typeof sessionId !== "string" || !sessionId || typeof mediaId !== "string" || !mediaId) return;
  const access = await getSessionAccessRole(user.id, sessionId);
  const blobToken = token();
  if (!access || !blobToken) redirect("/sessions");
  const scopedDb = await getScopedPrisma(user.id);
  const [session, media] = await Promise.all([
    scopedDb.session.findUnique({ where: { id: sessionId }, select: { createdById: true } }),
    prisma.sessionGalleryMedia.findFirst({ where: { id: mediaId, sessionId } }),
  ]);
  if (!session || !media || session.createdById !== user.id) return;
  if (!checkRateLimit(user.id, "deleteSessionGalleryImage")) redirect(`/sessions/${sessionId}?gallery=indisponible`);
  await prisma.sessionGalleryMedia.delete({ where: { id: media.id } });
  await del(media.pathname, { token: blobToken }).catch(() => undefined);
  revalidatePath(`/sessions/${sessionId}`);
  redirect(`/sessions/${sessionId}?gallery=ok`);
}
