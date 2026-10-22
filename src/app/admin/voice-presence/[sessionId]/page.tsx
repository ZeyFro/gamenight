import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";
import { findActiveMembership, hasCommunityRole } from "@/lib/community-access";
import { prisma } from "@/lib/prisma";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { formatDateTimeFr } from "@/lib/wallclock";
import { readSessionVoicePresence } from "@/lib/session-voice-presence";
import { SessionVoicePresencePanel } from "@/components/sessions/SessionVoicePresencePanel";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Durées vocales de la soirée");

export default async function VoicePresenceAdminSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  if (!user) redirect("/");
  const { sessionId } = await params;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, date: true, communityId: true },
  });
  if (!session) notFound();

  const isSiteAdmin = isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS));
  if (!isSiteAdmin) {
    const communityId = await statsCommunityIdForSession(session.communityId);
    const membership = await findActiveMembership(user.id, communityId);
    if (!membership || !hasCommunityRole(membership.role, "ADMIN")) notFound();
  }

  const presence = await readSessionVoicePresence(session.id, user.id);
  if (!presence?.canReadAll) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link href="/admin/voice-presence" className="text-sm text-muted hover:underline">← Durées vocales</Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">{formatDateTimeFr(session.date)}</h1>
        <p className="mt-1 text-sm text-muted">Panneau de présence vocale autorisé par ton rôle d&apos;admin.</p>
      </div>
      <SessionVoicePresencePanel sessionId={session.id} presence={presence} />
    </main>
  );
}
