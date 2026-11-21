"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteMyAccountAction } from "@/app/profil/compte/actions";
import { ACCOUNT_DELETION_CONFIRM_WORD, isAccountDeletionConfirmed } from "@/lib/account-deletion-flag";
import { Button } from "@/components/ui/Button";

function SubmitButton({ allowed }: { allowed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" fullWidthOnMobile disabled={!allowed || pending}>
      {pending ? "Suppression en cours…" : "Supprimer définitivement mon compte"}
    </Button>
  );
}

/** Confirmation forte : le pseudo exact ou « SUPPRIMER ». Le serveur revérifie, le bouton n'est qu'une aide. */
export function DeleteAccountForm({ discordName }: { discordName: string }) {
  const [typed, setTyped] = useState("");
  const allowed = isAccountDeletionConfirmed(typed, discordName);
  return (
    <form action={deleteMyAccountAction} className="flex flex-col gap-3">
      <label className="grid gap-1 text-sm text-foreground">
        Pour confirmer, tape ton pseudo (<strong>{discordName}</strong>) ou le mot <strong>{ACCOUNT_DELETION_CONFIRM_WORD}</strong>
        <input
          name="confirmation"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="rounded-lg border border-border bg-background px-3 py-3 text-base"
        />
      </label>
      <SubmitButton allowed={allowed} />
    </form>
  );
}
