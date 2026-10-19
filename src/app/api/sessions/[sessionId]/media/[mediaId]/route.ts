import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getSessionAccessRole } from "@/lib/session-access";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { isSessionVideoEnabled, parseSessionGalleryRange, SESSION_GALLERY_MAX_BYTES } from "@/lib/session-gallery";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; mediaId: string }> }
) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return new NextResponse(null, { status: 404 });
  const { sessionId, mediaId } = await params;
  if (!(await getSessionAccessRole(user.id, sessionId))) return new NextResponse(null, { status: 404 });
  const token = process.env.SESSION_MEDIA_BLOB_TOKEN;
  if (!token) return new NextResponse(null, { status: 404 });
  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session) return new NextResponse(null, { status: 404 });
  const communityId = await statsCommunityIdForSession(session.communityId);
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { sessionGalleryEnabled: true } });
  if (!community?.sessionGalleryEnabled) return new NextResponse(null, { status: 404 });
  const media = await prisma.sessionGalleryMedia.findFirst({ where: { id: mediaId, sessionId } });
  if (!media) return new NextResponse(null, { status: 404 });
  const isVideo = media.mimeType === "video/mp4";
  if (isVideo && !isSessionVideoEnabled()) return new NextResponse(null, { status: 404 });
  if (isVideo && media.sizeBytes > SESSION_GALLERY_MAX_BYTES) return new NextResponse(null, { status: 404 });
  const rangeHeader = isVideo ? _request.headers.get("range") : null;
  const range = rangeHeader ? parseSessionGalleryRange(rangeHeader, media.sizeBytes) : null;
  if (rangeHeader && !range) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${media.sizeBytes}`, "Accept-Ranges": "bytes" } });
  const blob = await get(media.pathname, { access: "private", token }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return new NextResponse(null, { status: 404 });
  let body: ReadableStream<Uint8Array> = blob.stream;
  if (range) {
    const reader = blob.stream.getReader();
    const content = new Uint8Array(range.end - range.start + 1);
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkStart = total;
      total += value.byteLength;
      if (total > SESSION_GALLERY_MAX_BYTES || total > media.sizeBytes) {
        await reader.cancel();
        return new NextResponse(null, { status: 404 });
      }
      const copyStart = Math.max(chunkStart, range.start);
      const copyEnd = Math.min(total, range.end + 1);
      if (copyStart < copyEnd) content.set(value.subarray(copyStart - chunkStart, copyEnd - chunkStart), copyStart - range.start);
    }
    if (total !== media.sizeBytes) return new NextResponse(null, { status: 404 });
    body = new ReadableStream({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    });
  }
  const headers = new Headers({
    "Content-Type": media.mimeType,
    "Content-Length": range ? String(range.end - range.start + 1) : String(media.sizeBytes),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${media.sizeBytes}`);
  if (isVideo) headers.set("Accept-Ranges", "bytes");
  return new NextResponse(body, {
    status: range ? 206 : 200,
    headers,
  });
}
