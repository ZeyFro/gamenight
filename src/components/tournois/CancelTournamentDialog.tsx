"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { cancelTournamentAction } from "@/app/tournois/actions";

/**
 * Annulation d'un tournoi DÉMARRÉ, réservée au créateur (bouton rendu côté
 * créateur uniquement, cf. page appelante — la garde server-side dans
 * `cancelTournament`, src/lib/tournaments.ts, reste la vraie protection).
 * Contrairement à la suppression, les matchs et résultats déjà enregistrés
 * sont explicitement CONSERVÉS — confirmation explicite obligatoire avant
 * envoi, même pattern que `DeleteTournamentDialog`/`DeleteSessionDialog`.
 */
export function CancelTournamentDialog({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Annuler le tournoi
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
              Annuler ce tournoi ?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Le tournoi s&apos;arrête là : plus aucun match ne pourra être joué. Les matchs et
              résultats déjà enregistrés restent visibles, rien n&apos;est supprimé. Si une
              annonce a été postée dans Discord, elle sera éditée pour indiquer
              &laquo;&nbsp;annulé&nbsp;&raquo; et le fil associé sera fermé.
            </Dialog.Description>

            <div className="mt-4 flex gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" className="flex-1">
                  Retour
                </Button>
              </Dialog.Close>
              <form action={cancelTournamentAction} className="flex-1">
                <input type="hidden" name="tournamentId" value={tournamentId} />
                <Button type="submit" variant="destructive" className="w-full">
                  Oui, annuler
                </Button>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
