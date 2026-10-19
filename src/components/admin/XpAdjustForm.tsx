"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { ActionForm } from "@/components/ActionForm";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { adjustPlayerXpAction } from "@/app/admin/joueurs/actions";

const ERROR_MESSAGES: Record<string, string> = {
  [RATE_LIMIT_ERROR_KEY]: RATE_LIMIT_MESSAGE,
  unauthorized: "Accès réservé aux admins.",
  invalid: "Valeur invalide : un nombre entier d'XP, de 0 à 10 000 000.",
  not_member: "Ce joueur n'est plus membre actif de cette communauté.",
  unchanged: "Cette valeur est déjà celle du joueur : rien à corriger.",
  stale: "L'XP du joueur a changé entre-temps. La fiche est rechargée : vérifie la nouvelle valeur.",
  community_changed: "Ta communauté actuelle a changé. La fiche est rechargée.",
};

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function describe(xp: number) {
  const level = levelForXp(xp);
  return `${xp.toLocaleString("fr-FR")} XP · niveau ${level} · ${rankForLevel(level).name}`;
}

/**
 * Formulaire de correction d'XP : saisie de la nouvelle valeur (remplacement, pas un
 * delta) et d'une raison facultative, puis confirmation en deux temps (même gabarit
 * que `ForceReloginCard`) montrant la progression, le niveau et le rang avant → après.
 */
export function XpAdjustForm({
  communityId,
  communityName,
  userId,
  userName,
  currentXp,
}: {
  communityId: string;
  communityName: string;
  userId: string;
  userName: string;
  currentXp: number;
}) {
  const [value, setValue] = useState(String(currentXp));
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const parsed = /^\d{1,8}$/.test(value.trim()) ? Number(value.trim()) : null;
  const valid = parsed !== null && parsed <= 10_000_000 && parsed !== currentXp;
  const nextXp = valid ? parsed : currentXp;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Nouvelle valeur d&apos;XP
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={FIELD_CLASS}
          aria-describedby="xp-adjust-hint"
        />
        <span id="xp-adjust-hint" className="text-xs font-normal text-muted">
          Remplace la progression actuelle ({currentXp.toLocaleString("fr-FR")} XP). Le même écart est appliqué au solde dépensable, sans passer sous zéro. Entier de 0 à 10 000 000.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Raison (facultative)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Ex. : abus création/suppression de soirées"
          className={FIELD_CLASS}
        />
      </label>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button type="button" variant="primary" fullWidthOnMobile disabled={!valid}>
            Corriger l&apos;XP…
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
                Corriger l&apos;XP de {userName} ?
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted">
                Communauté : {communityName}. L&apos;action est enregistrée dans le journal (admin, date, ancienne et
                nouvelle valeur).
              </Dialog.Description>

              <dl className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted">Avant</dt>
                  <dd className="font-medium text-foreground">{describe(currentXp)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Après</dt>
                  <dd className="font-semibold text-accent">{describe(nextXp)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" className="flex-1">
                    Annuler
                  </Button>
                </Dialog.Close>
                <ActionForm
                  action={adjustPlayerXpAction}
                  successMessage="XP corrigée."
                  errorMessages={ERROR_MESSAGES}
                  onSuccess={() => {
                    setOpen(false);
                    router.refresh();
                  }}
                  className="flex-1"
                >
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="communityId" value={communityId} />
                  <input type="hidden" name="expectedOldXp" value={currentXp} />
                  <input type="hidden" name="newXp" value={nextXp} />
                  <input type="hidden" name="reason" value={reason} />
                  <Button type="submit" variant="primary" className="w-full">
                    Confirmer
                  </Button>
                </ActionForm>
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
