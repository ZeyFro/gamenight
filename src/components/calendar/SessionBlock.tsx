"use client";

import { useRef, useState, type TouchEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { ButtonLink } from "@/components/ui/Button";
import { VoterAvatars } from "@/components/VoterAvatars";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, toTimeInputValue } from "@/lib/wallclock";
import type { CalendarSession } from "@/lib/calendar";

const STATUS_BLOCK_CLASSES: Record<CalendarSession["status"], string> = {
  // Orange/rouge : distinct de "Prévue" (violet accent), signale qu'il
  // reste une action à faire (voter) plutôt qu'une soirée déjà calée.
  VOTING: "border border-warning/50 bg-warning/10 text-warning",
  SCHEDULED: "border border-transparent bg-accent text-accent-foreground",
  DONE: "border border-border bg-white/5 text-muted",
  CANCELLED: "border border-destructive/40 bg-destructive/10 text-destructive line-through",
};

const SWIPE_CLOSE_MIN_DISTANCE_PX = 50;

/**
 * Bloc session sur le calendrier — pastille tap ouvrant un panneau
 * résumé. Sous-PR 3/3 : panneau latéral (slide-in depuis la droite,
 * style drawer mobile) plutôt que le bottom-sheet des sous-PR
 * précédentes — fermeture au swipe (vers la droite, direction d'où le
 * panneau est venu) en plus du tap en dehors (comportement Radix natif
 * sur l'overlay). Volontairement lecture seule : "Voter"/"Modifier"
 * inline restent hors périmètre, ce panneau résume + renvoie vers
 * `/sessions/[id]` pour toute action.
 */
export function SessionBlock({ session }: { session: CalendarSession }) {
  const [open, setOpen] = useState(false);
  const statusInfo = SESSION_STATUS_LABELS[session.status];
  const title = session.decidedGameName ?? "Vote en cours";
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const deltaX = t.clientX - touchStart.current.x;
    const deltaY = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (deltaX < SWIPE_CLOSE_MIN_DISTANCE_PX) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-medium transition-opacity hover:opacity-90 ${STATUS_BLOCK_CLASSES[session.status]}`}
        >
          🎮 {toTimeInputValue(session.date)} · {title}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="fixed inset-y-0 right-0 z-50 flex h-full w-[85vw] max-w-sm flex-col overflow-y-auto border-l border-border bg-surface p-4 sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {session.decidedGameName ? `🎮 ${session.decidedGameName}` : "Soirée en vote"}
              </Dialog.Title>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
            </div>

            <p className="mt-2 text-sm text-muted">{formatDateTimeFr(session.date)}</p>

            {session.status === "VOTING" && session.votingDeadline && (
              <p className="mt-1 text-xs text-warning">
                Vote fermé le {formatDateTimeFr(session.votingDeadline)}
              </p>
            )}

            {session.players.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-muted">Joueurs inscrits</h3>
                <VoterAvatars voters={session.players} />
              </div>
            )}

            {session.proposals.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-muted">Propositions</h3>
                {session.proposals.map((p) => (
                  <div
                    key={p.gameName}
                    className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm"
                  >
                    <span className="truncate text-foreground">{p.gameName}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {p.voteCount} vote{p.voteCount === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <Dialog.Close asChild>
                <ButtonLink
                  href={`/sessions/${session.id}`}
                  variant="primary"
                  fullWidthOnMobile
                  className="flex-1"
                >
                  Voir la fiche complète
                </ButtonLink>
              </Dialog.Close>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
