"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sessionPreparationAction } from "@/app/sessions/actions/preparation";
import { preparationLabels } from "@/lib/session-preparation-config";
import { Card } from "@/components/ui/Card";

type Participant = { id: string; discordName: string; installed: boolean; updated: boolean; microphone: boolean; lobby: boolean };
const fields = Object.keys(preparationLabels) as (keyof typeof preparationLabels)[];
export function SessionPreparationPanel({ sessionId, userId, participants }: { sessionId: string; userId: string; participants: Participant[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();
  return <Card>
    <h2 className="text-lg font-semibold">Préparation</h2>
    <p className="text-sm text-muted">{participants.filter(person => fields.every(field => person[field])).length}/{participants.length} participants prêts</p>
    {participants.length === 0 && <p>Aucun participant confirmé.</p>}
    {participants.map(person => <fieldset key={person.id} disabled={pending || person.id !== userId} className="mt-3 flex flex-wrap gap-3">
      <legend>{person.discordName}</legend>
      {fields.map(field => <label key={field} className="flex items-center gap-2">
        <input type="checkbox" checked={person[field]} onChange={event => {
          const checked = event.target.checked;
          startTransition(async () => {
            setError(false);
            try {
              const result = await sessionPreparationAction({ sessionId, field, checked });
              if (!result.ok) setError(true);
              else router.refresh();
            } catch { setError(true); }
          });
        }} />{preparationLabels[field]}
      </label>)}
    </fieldset>)}
    {error && <p role="alert">Préparation non enregistrée. Actualise la page et réessaie.</p>}
  </Card>;
}
