"use client";

import { useActionState } from "react";
import { configureTowerChallengeArbiterAction, decideTowerChallengeAppealAction, type TowerAppealReviewState } from "@/app/admin/tower-appeals/actions";

const initial: TowerAppealReviewState = { status: "" };
const messages: Record<string, string> = {
  ARBITER_CONFIGURED: "Configuration enregistrée et changement journalisé.",
  CONFIGURATION_LOCKED: "Une contestation est ouverte : aucun changement d’arbitre n’est possible.",
  UNCHANGED: "Cet arbitre est déjà configuré.",
  ARBITER_INELIGIBLE: "L’arbitre doit être un autre membre actif, sans rôle de gestion.",
  APPEAL_UPHELD: "Refus confirmé, décision enregistrée.",
  APPEAL_OVERTURNED: "Refus renversé, décision enregistrée sans double récompense.",
  DAILY_LIMIT: "Plafond quotidien atteint : la contestation reste ouverte.",
  ALREADY_DECIDED: "Cette contestation a déjà été tranchée.",
  FORBIDDEN: "Tu n’es pas autorisé à effectuer cette action.",
};

export function TowerArbiterConfiguration({ candidates, arbiterUserId, locked }: {
  candidates: { userId: string; discordName: string }[]; arbiterUserId: string | null; locked: boolean;
}) {
  const [state, configure, pending] = useActionState(configureTowerChallengeArbiterAction, initial);
  return <form action={configure} className="flex flex-col gap-3">
    <p className="text-sm text-muted">L’arbitre est déclaré avant les contestations. Chaque changement est journalisé. Aucun changement n’est possible tant qu’une contestation est ouverte.</p>
    <p className="text-sm text-muted">Le rôle GameNight est vérifié ici ; le propriétaire doit aussi vérifier l’absence de droits d’administration Discord.</p>
    <p className="text-sm text-muted">{arbiterUserId ? `Arbitre actuel : ${candidates.find(c => c.userId === arbiterUserId)?.discordName ?? "membre actuellement indisponible"}.` : "Aucun arbitre configuré."}</p>
    <label className="flex flex-col gap-1 text-sm">Arbitre indépendant
      <select name="arbiterUserId" required defaultValue={arbiterUserId ?? ""} disabled={locked || pending} className="rounded-lg border border-border bg-background p-2">
        <option value="">Choisir un membre</option>
        {candidates.map(c => <option key={c.userId} value={c.userId}>{c.discordName}</option>)}
      </select>
    </label>
    <button type="submit" disabled={locked || pending} className="rounded-lg bg-accent p-2 text-white disabled:opacity-50">Enregistrer la configuration</button>
    {locked && <p className="text-sm text-muted">Configuration verrouillée pendant les contestations ouvertes.</p>}
    {state.status && <p role="status">{messages[state.status] ?? "Configuration refusée."}</p>}
  </form>;
}

export function TowerChallengeAppealControls({ appealId, canDecide }: { appealId: string; canDecide: boolean }) {
  const [state, decide, pending] = useActionState(decideTowerChallengeAppealAction, initial);
  return <div className="mt-4 border-t border-border pt-4">
    {canDecide && <form action={decide} className="flex flex-col gap-2">
      <input type="hidden" name="appealId" value={appealId} />
      <label htmlFor={`decision-${appealId}`}>Motif de la décision</label>
      <textarea id={`decision-${appealId}`} name="decisionReason" required minLength={1} maxLength={1000} rows={3} className="rounded-lg border border-border bg-background p-2" />
      <div className="flex gap-2">
        <button name="decision" value="UPHELD" disabled={pending} className="rounded-lg border border-border p-2">Confirmer le refus</button>
        <button name="decision" value="OVERTURNED" disabled={pending} className="rounded-lg bg-accent p-2 text-white">Renverser le refus</button>
      </div>
    </form>}
    {state.status && <p role="status">{messages[state.status] ?? "Décision refusée."}</p>}
  </div>;
}
