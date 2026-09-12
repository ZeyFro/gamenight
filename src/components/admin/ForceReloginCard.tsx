"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ActionForm } from "@/components/ActionForm";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { forceReloginAction } from "@/app/admin/reglages/actions";

/**
 * Reconnexion forcée globale (voir `src/lib/force-relogin.ts`) — action
 * exceptionnelle et à fort impact (déconnecte TOUT LE MONDE + notif Discord
 * publique), donc double confirmation avant envoi, même gabarit que
 * `DeleteSessionDialog` (seule autre action destructrice du projet).
 */
export function ForceReloginCard({ lastTriggeredLabel }: { lastTriggeredLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          🔄 Forcer la reconnexion globale
        </h2>
        <p className="mt-1 text-sm text-muted">
          Déconnecte tout le monde et poste un message Discord invitant à se
          reconnecter. Nécessaire pour que le cron des avatars Discord (voir
          README) puisse enregistrer le jeton de chaque personne — à
          utiliser une seule fois après ce déploiement.
        </p>
        {lastTriggeredLabel && (
          <p className="mt-2 text-xs text-muted">
            Dernier déclenchement : {lastTriggeredLabel}
          </p>
        )}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button type="button" variant="destructive" fullWidthOnMobile>
            Forcer la reconnexion de tout le monde
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
                Déconnecter tout le monde ?
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted">
                Chaque personne devra se reconnecter à Discord au prochain
                chargement de page. Un message sera posté dans Discord pour
                prévenir tout le monde.
              </Dialog.Description>

              <div className="mt-4 flex gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" className="flex-1">
                    Annuler
                  </Button>
                </Dialog.Close>
                <ActionForm
                  action={forceReloginAction}
                  successMessage="Reconnexion forcée envoyée à tout le monde."
                  errorMessages={{ [RATE_LIMIT_ERROR_KEY]: RATE_LIMIT_MESSAGE }}
                  onSuccess={() => router.push("/")}
                  className="flex-1"
                >
                  <Button
                    type="submit"
                    variant="destructive"
                    className="w-full"
                    onClick={() => setOpen(false)}
                  >
                    Oui, déconnecter tout le monde
                  </Button>
                </ActionForm>
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}
