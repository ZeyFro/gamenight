"use client";

import { useActionState } from "react";
import {
  appointTowerChallengeArbiterAction,
  decideTowerChallengeAppealAction,
  type TowerAppealReviewState,
} from "@/app/admin/tower-appeals/actions";

const initial: TowerAppealReviewState = { status: "" };
const statusMessage: Record<string, string> = {
  APPEAL_UPHELD: "Refus confirmé. Le motif et l’arbitrage sont conservés.",
  APPEAL_OVERTURNED: "Refus renversé. La récompense suit le plafond quotidien existant.",
  DAILY_LIMIT: "Le plafond quotidien de l’auteur est atteint. La contestation reste ouverte pour réexamen après la remise à zéro.",
  ALREADY_DECIDED: "Cette contestation a déjà été tranchée.",
  FORBIDDEN: "Tu n’es pas autorisé à statuer sur ce dossier.",
  ARBITER_ASSIGNED: "Arbitre indépendant désigné.",
  ARBITER_ALREADY_SET: "Un arbitre est déjà désigné pour ce dossier.",
  ARBITER_INELIGIBLE: "Ce membre a participé au dossier ou n’a pas le rôle requis.",
};

export function TowerChallengeAppealControls({
  appealId,
  canDecide,
  needsArbiter,
  candidates,
  existingArbiter,
}: {
  appealId: string;
  canDecide: boolean;
  needsArbiter: boolean;
  candidates: { userId: string; discordName: string }[];
  existingArbiter: string | null;
}) {
  const [decision, decide, decisionPending] = useActionState(decideTowerChallengeAppealAction, initial);
  const [nomination, nominate, nominationPending] = useActionState(appointTowerChallengeArbiterAction, initial);
  return <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
    {needsArbiter && <section className="flex flex-col gap-2">
      <h3 className="font-medium text-foreground">Arbitre indépendant</h3>
      <p className="text-sm text-muted">Le propriétaire désigne un membre actif qui n’a ni participé ni voté. Le choix doit aussi respecter les permissions Discord prévues pour l’arbitre.</p>
      {existingArbiter ? <p className="text-sm text-muted">Un arbitre a déjà été désigné; son accès à la décision est vérifié côté serveur.</p>
        : candidates.length ? <form action={nominate} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="appealId" value={appealId} />
          <label className="flex min-w-56 flex-col gap-1 text-sm text-foreground">Membre arbitre
            <select name="arbiterUserId" required className="rounded-lg border border-border bg-background p-2">
              <option value="">Choisir un membre</option>
              {candidates.map(candidate => <option key={candidate.userId} value={candidate.userId}>{candidate.discordName}</option>)}
            </select>
          </label>
          <button type="submit" disabled={nominationPending} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {nominationPending ? "Désignation…" : "Désigner l’arbitre"}
          </button>
        </form> : <p className="text-sm text-muted">Aucun membre actif indépendant n’est disponible; le dossier reste en attente.</p>}
      {nomination.status && <p role="status" className="text-sm text-muted">{statusMessage[nomination.status] ?? "La désignation n’a pas abouti."}</p>}
    </section>}
    {canDecide && <form action={decide} className="flex flex-col gap-2">
      <input type="hidden" name="appealId" value={appealId} />
      <label htmlFor={`tower-appeal-decision-${appealId}`} className="text-sm font-medium text-foreground">Motif de la décision</label>
      <textarea id={`tower-appeal-decision-${appealId}`} name="decisionReason" required minLength={1} maxLength={1500} rows={3}
        className="w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground" />
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="UPHELD" disabled={decisionPending}
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60">
          Confirmer le refus
        </button>
        <button name="decision" value="OVERTURNED" disabled={decisionPending}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          Renverser le refus
        </button>
      </div>
    </form>}
    {decision.status && <p role="status" className="text-sm text-muted">{statusMessage[decision.status] ?? "La décision n’a pas abouti."}</p>}
  </div>;
}
