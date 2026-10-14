"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useActionState, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { deleteTournamentAction, type DeleteTournamentActionState } from "@/app/tournois/actions";

const INITIAL_STATE: DeleteTournamentActionState = { error: null };

/**
 * Suppression définitive d'un tournoi NON démarré, réservée au créateur
 * (le bouton n'est même rendu que côté créateur, cf. page appelante — la
 * garde server-side dans `deleteTournament`, src/lib/tournaments.ts, reste
 * la vraie protection). Confirmation explicite obligatoire avant d'envoyer
 * le formulaire réel — même pattern que `DeleteSessionDialog`.
 *
 * Bug remonté en test réel (aucune redirection après suppression, page
 * incohérente, F5 nécessaire) — `useActionState` remplace le
 * `<form action={fn}>` brut d'origine : `pending` désactive le bouton dès
 * le premier clic (jamais de double soumission possible, jamais deux
 * résolutions concurrentes de la même transition), et une erreur RÉELLE
 * (tournoi déjà lancé entre-temps, etc.) s'affiche au lieu de ne rien
 * faire silencieusement. Le succès continue de passer par `redirect()`
 * côté serveur (voir `deleteTournamentAction`) — jamais intercepté ici.
 */
export function DeleteTournamentDialog({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteTournamentAction, INITIAL_STATE);

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
              Supprimer ce tournoi ?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              Définitif : le tournoi et les inscriptions en cours seront supprimés. Si une
              annonce a déjà été postée dans Discord, elle sera retirée et le fil associé sera
              définitivement supprimé, avec tous ses messages.
            </Dialog.Description>

            {state.error && (
              <p className="mt-3 rounded-lg bg-red-500/10 p-2 text-sm text-red-400" role="alert">
                {state.error}
              </p>
            )}

            <div className="mt-4 flex gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" className="flex-1" disabled={pending}>
                  Annuler
                </Button>
              </Dialog.Close>
              <form action={formAction} className="flex-1">
                <input type="hidden" name="tournamentId" value={tournamentId} />
                <Button type="submit" variant="destructive" className="w-full" disabled={pending}>
                  {pending ? "Suppression…" : "Oui, supprimer"}
                </Button>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
