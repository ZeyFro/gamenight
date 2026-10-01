"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useActionState, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { endInstantSessionAction } from "@/app/jouer-maintenant/actions";
import { INITIAL_INSTANT_SESSION_ACTION_STATE } from "@/app/jouer-maintenant/action-state";

/**
 * "Si le créateur quitte, la session se termine pour tous, APRÈS
 * CONFIRMATION EXPLICITE" — même pattern que `DeleteSessionDialog` :
 * confirmation obligatoire avant d'envoyer le formulaire réel. La garde
 * côté serveur (`endInstantSession` refuse tout appelant qui n'est pas le
 * créateur) reste la vraie protection, ce dialogue n'est qu'une étape
 * d'interface. `useActionState` (jamais un simple `<form action>`, voir
 * le commentaire de fichier de `actions.ts`) : bouton désactivé pendant
 * la soumission, empêche une double confirmation en rafale.
 */
export function EndInstantSessionDialog({ instantSessionId }: { instantSessionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    endInstantSessionAction,
    INITIAL_INSTANT_SESSION_ACTION_STATE
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Terminer la session
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
              Terminer cette session pour tout le monde ?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              En tant que créateur, quitter termine la session pour tous les participants présents.
              Elle ne pourra plus être rejointe ni modifiée. Les minutes déjà comptabilisées restent
              acquises.
            </Dialog.Description>
            {state.status === "error" && (
              <p className="mt-2 text-sm text-destructive">
                Impossible de terminer la session pour le moment. Réessaie.
              </p>
            )}

            <div className="mt-4 flex gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" className="flex-1">
                  Annuler
                </Button>
              </Dialog.Close>
              <form action={formAction} className="flex-1">
                <input type="hidden" name="instantSessionId" value={instantSessionId} />
                <Button type="submit" variant="destructive" className="w-full" disabled={pending}>
                  {pending ? "…" : "Oui, terminer"}
                </Button>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
