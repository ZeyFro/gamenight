import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";
import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { wallClockNow, formatDateTimeFr } from "@/lib/wallclock";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Durées vocales");

export default async function VoicePresenceAdminPage() {
  const user = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  if (!user) redirect("/");
  const isSiteAdmin = isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS));
  const communityIds = isSiteAdmin
    ? (await prisma.community.findMany({ select: { id: true } })).map(community => community.id)
    : (await prisma.membership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        role: { in: ["ADMIN", "OWNER"] },
        community: { status: "ACTIVE" },
      },
      select: { communityId: true },
    })).map(membership => membership.communityId);
  if (!isSiteAdmin && !communityIds.length) notFound();

  const now = wallClockNow();
  const sessionGroups = await Promise.all(communityIds.map(async communityId => {
    const scopedDb = await scopedPrismaForCommunityId(communityId);
    return scopedDb.session.findMany({
      where: {
        voicePresenceConsents: {
          some: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            intervals: { some: { expiresAt: { gt: now } } },
          },
        },
      },
      select: { id: true, date: true },
      orderBy: { date: "desc" },
      take: 100,
    });
  }));
  const sessions = sessionGroups.flat()
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, 100);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link href="/sessions" className="text-sm text-muted hover:underline">← Soirées</Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Durées vocales</h1>
        <p className="mt-1 text-sm text-muted">Cette page ne montre que les données de présence vocale de soirées autorisées par ton rôle d&apos;admin.</p>
      </div>
      {sessions.length ? (
        <ul className="flex flex-col gap-3">
          {sessions.map(session => (
            <li key={session.id}>
              <Link href={`/admin/voice-presence/${session.id}`} className="block rounded-xl border border-border bg-card p-4 hover:border-accent">
                <span className="font-medium">{formatDateTimeFr(session.date)}</span>
                <span className="ml-2 text-sm text-accent">Voir les durées →</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted">Aucune durée conservée pour le moment.</p>}
    </main>
  );
}
