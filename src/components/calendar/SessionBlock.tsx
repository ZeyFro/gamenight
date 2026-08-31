"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, toTimeInputValue } from "@/lib/wallclock";
import type { CalendarSession } from "@/lib/calendar";

const STATUS_BLOCK_CLASSES: Record<CalendarSession["status"], string> = {
  VOTING: "border border-accent/50 bg-accent/10 text-accent",
  SCHEDULED: "border border-transparent bg-accent text-accent-foreground",
  DONE: "border border-border bg-white/5 text-muted",
  CANCELLED: "border border-destructive/40 bg-destructive/10 text-destructive line-through",
};

/**
 * Bloc session sur le calendrier (PR 4/4, sous-PR 1) — pastille tap
 * ouvrant un panneau résumé (bottom-sheet, même pattern Radix Dialog que
 * `VoterAvatars`/`GameFilterDrawer`). Volontairement lecture seule ici :
 * "Voter"/"Modifier" inline arrivent en sous-PR 3, une fois le calendrier
 * lecture-seule validé — ce panneau ne fait que résumer + renvoyer vers
 * `/sessions/[id]` pour toute action.
 */
export function SessionBlock({ session }: { session: CalendarSession }) {
  const statusInfo = SESSION_STATUS_LABELS[session.status];
  const title = session.decidedGameName ?? "Vote en cours";

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-medium transition-opacity hover:opacity-90 ${STATUS_BLOCK_CLASSES[session.status]}`}
        >
          {toTimeInputValue(session.date)} · {title}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
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

/** Petit lien texte "→ Session" pour les cellules mois (pas la peine d'ouvrir le panneau depuis une case aussi petite). */
export function SessionMonthPill({ session }: { session: CalendarSession }) {
  const statusInfo = SESSION_STATUS_LABELS[session.status];
  return (
    <Link
      href={`/sessions/${session.id}`}
      title={`${toTimeInputValue(session.date)} · ${session.decidedGameName ?? "Vote en cours"} (${statusInfo.label})`}
      className={`block truncate rounded px-1 text-[9px] font-medium ${STATUS_BLOCK_CLASSES[session.status]}`}
    >
      {toTimeInputValue(session.date)} {session.decidedGameName ?? "Vote"}
    </Link>
  );
}
