"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useActionState, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { cancelRecurringSessionsAction, type CancelRecurringSessionsState } from "@/app/sessions/actions/session-lifecycle";

const initialState: CancelRecurringSessionsState = { error: null };

export function CancelRecurringSessionsDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelRecurringSessionsAction, initialState);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="destructive" size="sm">Annuler la suite de la série</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6">
            <Dialog.Title className="text-lg font-semibold">Annuler les occurrences à venir ?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">Toutes les soirées à venir encore en vote ou planifiées de cette série seront annulées. Les soirées passées ou terminées restent conservées. Les annonces et fils existants suivent les règles habituelles d’annulation.</Dialog.Description>
            {state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}
            <div className="mt-4 flex flex-col gap-3">
              <Dialog.Close asChild><Button type="button" disabled={pending}>Revenir</Button></Dialog.Close>
              <form action={action}>
                <input type="hidden" name="sessionId" value={sessionId} />
                <Button type="submit" variant="destructive" disabled={pending} className="w-full">{pending ? "Annulation…" : "Oui, annuler les occurrences à venir"}</Button>
              </form>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
