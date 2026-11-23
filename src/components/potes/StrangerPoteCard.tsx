import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { sendFriendRequestAction } from "@/app/potes/friends-actions";
import { getFriendRelation, listStrangerSessions } from "@/lib/friends";
import { FRIEND_RELATION_LABELS } from "@/lib/friends-rules";
import { formatDateTimeFr } from "@/lib/wallclock";
import { plural } from "@/lib/plural";

/**
 * Fiche réduite d’un membre qui n’est PAS (encore) un ami (POTES_FRIENDS_ENABLED) : pseudo, avatar, état de la demande
 * d’ami et ses prochaines soirées vues de loin (publique : on peut la rejoindre ; privée : sur invitation). Jamais son
 * niveau, ses badges, sa bibliothèque, ses statistiques ni ses identifiants de jeu.
 */
export async function StrangerPoteCard({ viewerId, poteId }: { viewerId: string; poteId: string }) {
  const [user, relation, sessions] = await Promise.all([
    prisma.user.findUnique({ where: { id: poteId }, select: { id: true, discordName: true, discordAvatar: true } }),
    getFriendRelation(viewerId, poteId),
    listStrangerSessions(viewerId, poteId),
  ]);
  if (!user) return null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/potes" className="gn-touch-target relative text-sm text-accent">← Potes</Link>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar src={user.discordAvatar} alt="" size={56} />
            <div>
              <h1 className="text-xl font-semibold text-foreground">{user.discordName}</h1>
              <p className="text-sm text-muted">Vous n’êtes pas encore amis : son profil est réservé à ses amis.</p>
            </div>
          </div>
          {relation === "none" ? (
            <form action={sendFriendRequestAction}>
              <input type="hidden" name="targetId" value={user.id} />
              <input type="hidden" name="returnPoteId" value={user.id} />
              <Button type="submit">Demander en ami</Button>
            </form>
          ) : relation === "pending_received" ? (
            <Link href="/potes" className="text-sm text-accent">Il t’a demandé en ami : réponds dans « Demandes reçues »</Link>
          ) : (
            <span className="text-sm text-muted">{FRIEND_RELATION_LABELS[relation]}</span>
          )}
        </div>
      </Card>
      {(sessions.open.length > 0 || sessions.privateCount > 0) && (
        <Card>
          <h2 className="font-semibold text-foreground">Ses prochaines soirées</h2>
          <ul className="mt-3 grid gap-2 text-sm" aria-label="Prochaines soirées">
            {sessions.open.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground">
                  {session.kind === "PUBLIC" ? "Soirée publique" : "Soirée sur candidature"} · {formatDateTimeFr(session.date)}
                </span>
                <Link href="/sessions" className="text-accent hover:underline">
                  {session.kind === "PUBLIC" ? "La rejoindre dans « Soirées ouvertes »" : "Candidater dans « Soirées ouvertes »"}
                </Link>
              </li>
            ))}
            {sessions.privateCount > 0 && (
              <li className="text-muted">
                {sessions.privateCount} {plural(sessions.privateCount, "soirée privée", "soirées privées")} à venir : sur invitation seulement.
              </li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
