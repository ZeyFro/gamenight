"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type SVGProps } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { editSessionAction } from "@/app/sessions/actions/session-lifecycle";

/**
 * Édition du créneau d'une session (date, heure, deadline de vote),
 * réservée au créateur (le bouton n'est même rendu que côté créateur, cf.
 * page appelante — la garde server-side dans `editSessionAction` reste la
 * vraie protection). Contrairement à `DeleteSessionDialog`, les champs
 * deadline sont ici en saisie directe (pas de préréglages "6h avant" comme
 * à la création) : on édite un créneau déjà existant, donc on préremplit
 * avec les valeurs actuelles plutôt que de reproposer des presets relatifs.
 */
export function EditSessionDialog({
  sessionId,
  dateValue,
  timeValue,
  deadlineDateValue,
  deadlineTimeValue,
}: {
  sessionId: string;
  dateValue: string;
  timeValue: string;
  deadlineDateValue: string;
  deadlineTimeValue: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <PencilIcon className="h-4 w-4" />
          Modifier
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
          >
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Modifier la soirée
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Le groupe sera prévenu dans Discord du changement de créneau.
            </Dialog.Description>

            <form action={editSessionAction} className="mt-4 flex flex-col gap-4">
              <input type="hidden" name="sessionId" value={sessionId} />

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="edit-session-date">
                    Date
                  </label>
                  <input
                    id="edit-session-date"
                    type="date"
                    name="date"
                    required
                    defaultValue={dateValue}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="edit-session-time">
                    Heure
                  </label>
                  <input
                    id="edit-session-time"
                    type="time"
                    name="time"
                    required
                    defaultValue={timeValue}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="edit-deadline-date">
                    Date limite de vote
                  </label>
                  <input
                    id="edit-deadline-date"
                    type="date"
                    name="deadlineDate"
                    required
                    defaultValue={deadlineDateValue}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="edit-deadline-time">
                    Heure limite
                  </label>
                  <input
                    id="edit-deadline-time"
                    type="time"
                    name="deadlineTime"
                    required
                    defaultValue={deadlineTimeValue}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" className="flex-1">
                    Annuler
                  </Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" className="flex-1">
                  Enregistrer
                </Button>
              </div>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13.586 2.586a2 2 0 0 1 2.828 2.828l-9.5 9.5a1 1 0 0 1-.39.242l-3.5 1.166a.5.5 0 0 1-.632-.632l1.166-3.5a1 1 0 0 1 .242-.39l9.5-9.5-9.5 9.5Zm1.414 1.414L5.5 13.5l-.834 2.5 2.5-.834 9.5-9.5-1.666-1.666Z" />
    </svg>
  );
}
