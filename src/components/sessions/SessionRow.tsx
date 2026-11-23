import Link from "next/link";
import type { Game, Session } from "@prisma/client";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { plural } from "@/lib/plural";

export type SessionParticipant = {
  discordName: string;
  discordAvatar: string | null;
  color: string;
};

export type SessionRowData = Session & {
  decidedGame: Game | null;
  communityTeam: { name: string } | null;
  _count: { proposals: number };
  proposals: { gameId: string; votes: { userId: string; user: SessionParticipant }[] }[];
};

// Même logique que la home ("joueurs inscrits") : voteurs de la
// proposition gagnante une fois le jeu décidé, sinon l'ensemble des
// voteurs toutes propositions confondues (VOTING).
function getParticipants(session: SessionRowData) {
  const relevantProposals = session.decidedGameId
    ? session.proposals.filter((p) => p.gameId === session.decidedGameId)
    : session.proposals;
  const byUser = new Map<string, SessionParticipant>();
  for (const p of relevantProposals) {
    for (const v of p.votes) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, v.user);
    }
  }
  return [...byUser.entries()].map(([userId, user]) => ({ userId, ...user }));
}

/**
 * Carte de soirée de la liste `/sessions`. Extraite de la page pour être
 * testable seule (aucune logique métier ici).
 *
 * Mobile (phase 2) : la date n'est plus tronquée — à 320 px elle passait sur
 * une seule ligne coupée et l'heure de la soirée disparaissait. Elle passe
 * désormais à la ligne, sans troncature ; seul le nom du jeu reste tronqué.
 */
export function SessionRow({
  session,
  needsSuperlativeVote,
}: {
  session: SessionRowData;
  needsSuperlativeVote: boolean;
}) {
  const status = SESSION_STATUS_LABELS[session.status];
  const participants = getParticipants(session);
  return (
    <Link href={`/sessions/${session.id}`}>
      <div className="card-glow flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-all duration-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground leading-tight first-letter:uppercase">
              {formatDateTimeFr(session.date)}
            </p>
            <p className="truncate text-sm text-muted">
              {session.decidedGame
                ? session.decidedGame.name
                : `${session._count.proposals} ${plural(session._count.proposals, "proposition")}`}
            </p>
            {session.communityTeam && <p className="truncate text-xs text-accent">Équipe · {session.communityTeam.name}</p>}
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        {participants.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {participants.slice(0, 5).map((p) => (
                <Avatar
                  key={p.userId}
                  src={p.discordAvatar}
                  alt={p.discordName}
                  size={22}
                  className="ring-2 ring-surface"
                />
              ))}
              {participants.length > 5 && (
                <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-hover text-[10px] font-semibold text-muted ring-2 ring-surface">
                  +{participants.length - 5}
                </div>
              )}
            </div>
            <span className="text-xs text-muted">
              {participants.length} {plural(participants.length, "joueur")} {plural(participants.length, "inscrit")}
            </span>
          </div>
        )}
        {needsSuperlativeVote && (
          <Badge tone="accent" glow animate className="w-fit">
            🏆 Vote les récompenses !
          </Badge>
        )}
      </div>
    </Link>
  );
}
