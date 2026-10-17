import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getSessionAccessRole } from "@/lib/session-access";
import { statsCommunityIdForSession } from "@/lib/community-stats";

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
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session) return new NextResponse(null, { status: 404 });
  const communityId = await statsCommunityIdForSession(session.communityId);
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { sessionGalleryEnabled: true } });
  if (!community?.sessionGalleryEnabled) return new NextResponse(null, { status: 404 });
  const media = await prisma.sessionGalleryMedia.findFirst({ where: { id: mediaId, sessionId } });
  if (!media) return new NextResponse(null, { status: 404 });
  const blob = await get(media.pathname, { access: "private", token }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return new NextResponse(null, { status: 404 });
  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.sizeBytes),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
