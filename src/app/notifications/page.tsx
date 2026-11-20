import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { groupNotifications } from "@/lib/notifications";
import { isNotificationCenterEnabled, listOwnGamePingOptIns, MAX_GAME_PING_OPT_INS } from "@/lib/game-ping-optin";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { markAllNotificationsReadAction } from "@/app/notifications-actions";
import { markNotificationReadAction, toggleGamePingAction } from "./actions";

export const metadata = pageMetadata("Notifications");

const PAGE_SIZE = 30;

const PING_MESSAGES: Record<string, string> = {
  ok: "C’est noté.",
  rate_limited: "Trop de demandes, réessaie dans une minute.",
  invalide: "Demande invalide.",
  no_community: "Choisis un serveur dont tu es membre actif.",
  unknown_game: "Jeu introuvable.",
  too_many: `Tu peux suivre ${MAX_GAME_PING_OPT_INS} jeux au maximum.`,
  disabled: "Le centre de notifications est désactivé.",
};

export default async function NotificationCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string; ping?: string }>;
}) {
  if (!isNotificationCenterEnabled()) notFound();
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");

  const { filtre, ping } = await searchParams;
  const unreadOnly = filtre === "non-lues";
  const scopedDb = await getActiveScopedPrisma(user.id);
  const [rows, optIns, ownedGames] = await Promise.all([
    scopedDb.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    listOwnGamePingOptIns(user.id),
    prisma.userGame.findMany({
      where: { userId: user.id, owned: true },
      select: { gameId: true, game: { select: { name: true } } },
      orderBy: { game: { name: "asc" } },
      take: 100,
    }),
  ]);
  const items = await groupNotifications(rows, user.id);
  const optedIds = new Set(optIns.map((entry) => entry.gameId));
  const candidates = ownedGames.filter((entry) => !optedIds.has(entry.gameId));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🔔 Centre de notifications</h1>
        <p className="mt-1 text-sm text-muted">
          Un message privé Discord n’est envoyé que pour ce qui te vise personnellement (invitation, candidature, ton défi, contestation).
          Le reste arrive ici et en notification Web Push si tu l’as activée. Jamais de ping @everyone.
        </p>
      </div>

      {ping && PING_MESSAGES[ping] && (
        <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{PING_MESSAGES[ping]}</p>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex gap-3 text-sm" aria-label="Filtre">
            <Link href="/notifications" className={unreadOnly ? "text-muted" : "font-semibold text-foreground"}>Toutes</Link>
            <Link href="/notifications?filtre=non-lues" className={unreadOnly ? "font-semibold text-foreground" : "text-muted"}>Non lues</Link>
          </nav>
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="ghost" size="sm">Tout marquer comme lu</Button>
          </form>
        </div>
        {items.length === 0 ? (
          <EmptyState icon="🔔" title="Rien à signaler pour l’instant." />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className={`flex items-start gap-3 rounded-lg p-3 ${item.read ? "" : "bg-accent/10"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title}
                    {item.count > 1 && <span className="ml-1.5 text-xs text-muted">×{item.count}</span>}
                  </p>
                  <p className="text-xs text-muted">{item.message}</p>
                  <p className="text-[10px] text-faint">{formatDateTimeFr(new Date(item.createdAtIso))}</p>
                </div>
                {!item.read && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="ghost" size="sm">Lu</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Jeux que je veux suivre</h2>
        <p className="text-sm text-muted">
          Opt-in : tu reçois une notification dans l’app quand ce jeu est mis en avant dans ton serveur, et tu peux prendre le rôle du jeu
          avec /role pour être pingé dans les salons. Aucune mention de masse, aucun MP.
        </p>
        {optIns.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {optIns.map((entry) => (
              <li key={entry.gameId}>
                <form action={toggleGamePingAction} className="flex items-center gap-1 rounded-full bg-surface-hover px-3 py-1 text-sm">
                  <input type="hidden" name="gameId" value={entry.gameId} />
                  <input type="hidden" name="enabled" value="false" />
                  <span>{entry.name}</span>
                  <button type="submit" aria-label={`Ne plus suivre ${entry.name}`} className="text-muted hover:text-foreground">×</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {candidates.map((entry) => (
              <li key={entry.gameId}>
                <form action={toggleGamePingAction}>
                  <input type="hidden" name="gameId" value={entry.gameId} />
                  <input type="hidden" name="enabled" value="true" />
                  <Button type="submit" variant="secondary" size="sm">+ {entry.game.name}</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
