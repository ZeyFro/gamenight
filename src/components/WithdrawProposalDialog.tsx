"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { withdrawProposalAction } from "@/app/sessions/actions/proposals-votes";

/**
 * Retrait de sa propre proposition, réservé au user qui l'a proposée (le
 * bouton n'est même rendu que côté auteur, cf. page appelante — la garde
 * server-side dans `withdrawProposalAction` reste la vraie protection).
 * Ne redirige pas (contrairement à `deleteSessionAction`), donc géré ici
 * en `useTransition` + toast plutôt qu'un simple `<form action=...>`, pour
 * fermer la modal et donner un feedback sans quitter la page.
 */
export function WithdrawProposalDialog({
  sessionId,
  proposalId,
  gameName,
}: {
  sessionId: string;
  proposalId: string;
  gameName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("proposalId", proposalId);

    startTransition(async () => {
      await withdrawProposalAction(formData);
      toast.success("Proposition retirée");
      setOpen(false);
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-destructive"
        >
          Retirer ma proposition
        </button>
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
              Retirer {gameName} ?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Ta proposition et les votes qu&apos;elle a reçus seront
              supprimés.
            </Dialog.Description>

            <div className="mt-4 flex gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" className="flex-1">
                  Annuler
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={isPending}
                onClick={handleConfirm}
              >
                {isPending ? "…" : "Oui, retirer"}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
