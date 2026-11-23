"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { SVGProps } from "react";
import { removeUserGame } from "@/app/actions";
import { Button } from "@/components/ui/Button";

/**
 * Poubelle d'une jaquette de la bibliothèque : demande confirmation avant de retirer le jeu (bug 9 de l'audit du 23/11/2026,
 * un seul toucher du doigt retirait le jeu). Dialogue Radix (focus piégé, Échap pour annuler, bouton « Annuler » focalisé
 * d'abord, feuille en bas sur mobile) ; le retrait n'a lieu qu'au clic sur « Retirer », via la même action serveur qu'avant.
 */
export function RemoveGameConfirmDialog({ gameId, gameName }: { gameId: string; gameName: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Retirer ${gameName} de ma bibliothèque`}
          title="Retirer de ma bibliothèque"
          className="gn-touch-target relative flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-destructive/90 active:bg-destructive"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content
          role="alertdialog"
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
        >
          <Dialog.Title className="text-lg font-semibold text-foreground">Retirer {gameName} ?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">
            Le jeu disparaît de ta bibliothèque. Tu pourras toujours le rajouter plus tard.
          </Dialog.Description>
          <form action={removeUserGame} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <input type="hidden" name="gameId" value={gameId} />
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" autoFocus>
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="submit" variant="destructive">
              Retirer
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M8.75 1a.75.75 0 0 0-.75.75V2h-3a.75.75 0 0 0 0 1.5h.32l.83 11.6A2 2 0 0 0 8.14 17h3.72a2 2 0 0 0 1.99-1.9l.83-11.6h.32a.75.75 0 0 0 0-1.5h-3v-.25a.75.75 0 0 0-.75-.75h-2.5ZM7.6 3.5h4.8l-.82 11.5a.5.5 0 0 1-.5.46H8.92a.5.5 0 0 1-.5-.46L7.6 3.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
