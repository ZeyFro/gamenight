"use client";

import { useActionState } from "react";
import { submitTowerChallengeAppealAction, type TowerAppealFormState } from "@/app/tower/actions";

const initialState: TowerAppealFormState = { status: "" };
const messages: Record<string, string> = {
  APPEAL_SUBMITTED: "Ta contestation est transmise à l’équipe de modération.",
  ALREADY_APPEALED: "Une contestation existe déjà pour cette preuve.",
  AWAITING_ANNOUNCEMENT: "L’annonce du résultat est en attente. Ton délai de 24 heures n’a pas encore commencé.",
  WINDOW_CLOSED: "Le délai de contestation de 24 heures après l’annonce du résultat du vote est terminé.",
  CLOSED: "Cette preuve ne peut plus être contestée.",
  UNAVAILABLE: "Cette contestation n’est pas accessible depuis la communauté active.",
};

export function TowerChallengeAppealForm({ attemptId }: { attemptId: string }) {
  const [state, action, pending] = useActionState(submitTowerChallengeAppealAction, initialState);
  return <form action={action} className="mt-3 flex flex-col gap-2 rounded-xl border border-border p-3">
    <input type="hidden" name="attemptId" value={attemptId} />
    <label htmlFor={`tower-appeal-${attemptId}`} className="text-sm font-medium text-foreground">Contester ce refus</label>
    <textarea id={`tower-appeal-${attemptId}`} name="reason" required minLength={1} maxLength={1500} rows={3}
      className="w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground"
      placeholder="Explique pourquoi la preuve devrait être réexaminée." />
    <button type="submit" disabled={pending}
      className="self-start rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
      {pending ? "Envoi…" : "Envoyer la contestation"}
    </button>
    {state.status && <p role={state.status === "APPEAL_SUBMITTED" ? "status" : "alert"} className="text-sm text-muted">
      {messages[state.status] ?? "La contestation n’a pas pu être enregistrée."}
    </p>}
  </form>;
}
