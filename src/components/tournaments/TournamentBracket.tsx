"use client";

import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { declareWinnerAction } from "@/app/tournois/actions";

export interface BracketPlayer {
  id: string;
  discordName: string;
  discordAvatar: string | null;
}

export interface BracketMatch {
  id: string;
  round: number;
  position: number;
  player1: BracketPlayer | null;
  player2: BracketPlayer | null;
  winnerId: string | null;
}

const ROUND_LABEL_FROM_END = ["Finale", "Demi-finale", "Quarts de finale"];

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  return ROUND_LABEL_FROM_END[fromEnd] ?? `Round ${round}`;
}

/**
 * Bracket visuel (Sprint 5, FEATURE 1) — rendu récursif depuis la finale
 * (dernier round) vers le round 1 : chaque nœud empile ses 2 "enfants"
 * (round précédent, positions `2p`/`2p+1`, cf. `advanceWinner`,
 * src/lib/tournaments.ts) dans une colonne centrée verticalement
 * (`items-center` sur le conteneur flex parent) — l'alignement vertical
 * exact entre les rounds est garanti par le layout flexbox lui-même
 * (chaque paire d'enfants centre automatiquement son parent), sans le
 * moindre calcul de pixels à la main.
 */
export function TournamentBracket({
  matches,
  totalRounds,
  currentUserId,
  isCreator,
  interactive = true,
}: {
  matches: BracketMatch[];
  totalRounds: number;
  currentUserId: string;
  isCreator: boolean;
  /** V2 (annulation) — `false` pour un tournoi CANCELLED : matchs et
   * résultats déjà enregistrés restent affichés, mais plus aucun match
   * (même pas encore joué) ne peut être tranché — le tournoi est arrêté,
   * jamais une reprise possible. Sans ce garde, un match encore jouable
   * afficherait quand même ses boutons "X gagne" à ses deux joueurs
   * (`canDeclare` se base sur leur identité, pas sur `isCreator` seul) —
   * `declareWinnerAction` les refuserait bien côté serveur
   * (`match.tournament.status !== "IN_PROGRESS"`), mais jamais un bouton
   * mort affiché à tort. Par défaut `true` (comportement inchangé pour
   * IN_PROGRESS/DONE). */
  interactive?: boolean;
}) {
  const matchesByKey = new Map(matches.map((m) => [`${m.round}:${m.position}`, m]));

  return (
    <div className="overflow-x-auto pb-4">
      <div className="inline-flex min-w-full items-center px-2">
        <BracketNode
          matchesByKey={matchesByKey}
          round={totalRounds}
          position={0}
          totalRounds={totalRounds}
          currentUserId={currentUserId}
          isCreator={isCreator}
          interactive={interactive}
        />
      </div>
    </div>
  );
}

function BracketNode({
  matchesByKey,
  round,
  position,
  totalRounds,
  currentUserId,
  isCreator,
  interactive,
}: {
  matchesByKey: Map<string, BracketMatch>;
  round: number;
  position: number;
  totalRounds: number;
  currentUserId: string;
  isCreator: boolean;
  interactive: boolean;
}) {
  const match = matchesByKey.get(`${round}:${position}`);
  if (!match) return null;

  const canDeclare =
    interactive && (isCreator || match.player1?.id === currentUserId || match.player2?.id === currentUserId);

  const box = (
    <div className="flex flex-col gap-1.5">
      <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-faint">
        {roundLabel(round, totalRounds)}
      </p>
      <MatchCard match={match} canDeclare={canDeclare} />
    </div>
  );

  if (round === 1) return box;

  return (
    <div className="flex items-center gap-4 sm:gap-6">
      <div className="flex flex-col justify-center gap-6 border-r border-border pr-4 sm:pr-6">
        <ConnectorSlot>
          <BracketNode
            matchesByKey={matchesByKey}
            round={round - 1}
            position={position * 2}
            totalRounds={totalRounds}
            currentUserId={currentUserId}
            isCreator={isCreator}
            interactive={interactive}
          />
        </ConnectorSlot>
        <ConnectorSlot>
          <BracketNode
            matchesByKey={matchesByKey}
            round={round - 1}
            position={position * 2 + 1}
            totalRounds={totalRounds}
            currentUserId={currentUserId}
            isCreator={isCreator}
            interactive={interactive}
          />
        </ConnectorSlot>
      </div>
      {box}
    </div>
  );
}

function ConnectorSlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="absolute top-1/2 -right-4 h-px w-4 -translate-y-1/2 bg-border sm:-right-6 sm:w-6" />
    </div>
  );
}

function MatchCard({ match, canDeclare }: { match: BracketMatch; canDeclare: boolean }) {
  const isPlayable = Boolean(match.player1 && match.player2 && !match.winnerId);
  const isDone = Boolean(match.winnerId);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`w-44 shrink-0 overflow-hidden rounded-lg border bg-surface sm:w-52 ${
        isDone ? "border-accent/40" : "border-border"
      }`}
    >
      <PlayerRow player={match.player1} isWinner={isDone && match.winnerId === match.player1?.id} />
      <div className="h-px bg-border" />
      <PlayerRow player={match.player2} isWinner={isDone && match.winnerId === match.player2?.id} />

      {isPlayable && canDeclare && match.player1 && match.player2 && (
        <div className="flex gap-1 border-t border-border p-1.5">
          <form action={declareWinnerAction} className="flex-1">
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="winnerId" value={match.player1.id} />
            <button
              type="submit"
              className="w-full truncate rounded-md bg-accent/10 px-1.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
            >
              {match.player1.discordName} gagne
            </button>
          </form>
          <form action={declareWinnerAction} className="flex-1">
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="winnerId" value={match.player2.id} />
            <button
              type="submit"
              className="w-full truncate rounded-md bg-accent/10 px-1.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
            >
              {match.player2.discordName} gagne
            </button>
          </form>
        </div>
      )}
    </motion.div>
  );
}

function PlayerRow({ player, isWinner }: { player: BracketPlayer | null; isWinner: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 ${
        isWinner ? "bg-accent/10 font-semibold text-accent" : "text-foreground"
      }`}
    >
      {player ? (
        <>
          <Avatar src={player.discordAvatar} alt={player.discordName} size={20} />
          <span className="min-w-0 flex-1 truncate text-sm">{player.discordName}</span>
          {isWinner && <span aria-hidden>👑</span>}
        </>
      ) : (
        <span className="flex-1 truncate text-sm text-faint">En attente…</span>
      )}
    </div>
  );
}
