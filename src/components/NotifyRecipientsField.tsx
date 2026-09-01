"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ColorDot } from "@/components/ColorDot";
import { Stagger, StaggerItem } from "@/components/motion";

export interface NotifyRecipientCandidate {
  id: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
}

/**
 * Champ "Qui prévenir ?" du formulaire de création de soirée — même
 * pattern que `ReminderTimingsField` (état React local pour l'affichage,
 * lu depuis le `FormData` à la soumission via des checkboxes nommées
 * `notifyUserId`, pas besoin d'un `onChange` par ligne pour un simple
 * formulaire de création). Tout coché par défaut (`useState(() =>
 * potes.map(...))`) : décocher est l'action volontaire, cohérent avec la
 * demande ("par défaut tous les potes sont cochés").
 */
export function NotifyRecipientsField({
  potes,
}: {
  potes: NotifyRecipientCandidate[];
}) {
  const [checked, setChecked] = useState<string[]>(() => potes.map((p) => p.id));

  function toggle(id: string) {
    setChecked((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  if (potes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          Qui prévenir ? ({checked.length}/{potes.length})
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setChecked(potes.map((p) => p.id))}
            className="text-xs font-medium text-accent hover:underline"
          >
            Tout sélectionner
          </button>
          <button
            type="button"
            onClick={() => setChecked([])}
            className="text-xs font-medium text-accent hover:underline"
          >
            Tout désélectionner
          </button>
        </div>
      </div>

      <Stagger className="flex flex-col gap-1.5">
        {potes.map((pote) => {
          const isChecked = checked.includes(pote.id);
          return (
            <StaggerItem key={pote.id}>
              <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="notifyUserId"
                  value={pote.id}
                  checked={isChecked}
                  onChange={() => toggle(pote.id)}
                  className="h-5 w-5 shrink-0 rounded border-border accent-accent"
                />
                <Avatar src={pote.discordAvatar} alt={pote.discordName} size={28} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                  <span className="truncate">{pote.discordName}</span>
                  <ColorDot color={pote.color} />
                </span>
              </label>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
