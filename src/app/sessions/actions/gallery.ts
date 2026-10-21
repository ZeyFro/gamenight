"use server";

import { del, put } from "@vercel/blob";
import type { CommunityRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { canManageSessionContent } from "@/lib/session-content-access";
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
  if (!await canManageSessionContent(user.id, sessionId)) redirect("/sessions");

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session) redirect(`/sessions/${sessionId}?gallery=desactive`);
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
    const inserted = await prisma.$transaction(async tx => {
      // Aucun verrou pendant Blob : droits et capacité sont relus après l'envoi, jusqu'au commit.
      const [community] = await tx.$queryRaw<{ status: string; sessionGalleryEnabled: boolean }[]>`SELECT status, "sessionGalleryEnabled" FROM "Community" WHERE id = ${communityId} FOR SHARE`;
      const [member] = await tx.$queryRaw<{ status: string; role: CommunityRole }[]>`SELECT status, role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${user.id} FOR SHARE`;
      if (community?.status !== "ACTIVE" || !community.sessionGalleryEnabled) return false;
      if (member?.status !== "ACTIVE") return false;
      const [current] = await tx.$queryRaw<{ createdById: string; communityId: string | null }[]>`SELECT "createdById", "communityId" FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
      if (!current || current.communityId !== session.communityId) return false;
      if (current.createdById !== user.id) {
        if (member?.status !== "ACTIVE" || (member.role !== "ADMIN" && member.role !== "OWNER")) return false;
        const [invite] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "SessionInvite" WHERE "sessionId" = ${sessionId} AND "userId" = ${user.id} FOR SHARE`;
        if (invite?.status !== "ACTIVE") return false;
      }
      if (await tx.sessionGalleryMedia.count({ where: { sessionId } }) >= SESSION_GALLERY_MAX_ITEMS) return false;
      await tx.sessionGalleryMedia.create({
        data: { sessionId, uploadedById: user.id, pathname: blob.pathname, mimeType, sizeBytes: file.size },
      });
      return true;
    });
    if (!inserted) throw new Error("Gallery access or capacity changed during upload");
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
  const blobToken = token();
  if (!blobToken || !await canManageSessionContent(user.id, sessionId)) redirect("/sessions");
  const media = await prisma.sessionGalleryMedia.findFirst({ where: { id: mediaId, sessionId } });
  if (!media) return;
  if (!checkRateLimit(user.id, "deleteSessionGalleryImage")) redirect(`/sessions/${sessionId}?gallery=indisponible`);
  await prisma.sessionGalleryMedia.delete({ where: { id: media.id } });
  await del(media.pathname, { token: blobToken }).catch(() => undefined);
  revalidatePath(`/sessions/${sessionId}`);
  redirect(`/sessions/${sessionId}?gallery=ok`);
}
