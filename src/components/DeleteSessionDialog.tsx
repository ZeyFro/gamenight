"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { deleteSessionAction } from "@/app/sessions/actions";

/**
 * Suppression définitive d'une session, réservée au créateur (le bouton
 * n'est même rendu que côté créateur, cf. page appelante — la garde
 * server-side dans `deleteSessionAction` reste la vraie protection).
 * Confirmation obligatoire avant d'envoyer le formulaire réel.
 */
export function DeleteSessionDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Supprimer
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
              Supprimer cette soirée ?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Définitif : la soirée, ses propositions et les votes associés
              seront supprimés. Aucun message n&apos;est envoyé dans
              Discord.
            </Dialog.Description>

            <div className="mt-4 flex gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" className="flex-1">
                  Annuler
                </Button>
              </Dialog.Close>
              <form action={deleteSessionAction} className="flex-1">
                <input type="hidden" name="sessionId" value={sessionId} />
                <Button type="submit" variant="destructive" className="w-full">
                  Oui, supprimer
                </Button>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
