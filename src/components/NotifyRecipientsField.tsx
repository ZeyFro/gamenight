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
  /** Sprint 3 (FEATURE 6) — ids des tags perso de ce pote, pour la sélection groupée par tag ci-dessous. */
  tagIds: string[];
}

export interface NotifyTagOption {
  id: string;
  name: string;
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
 *
 * Sélection groupée par tag (Sprint 3, FEATURE 6) : cliquer un chip tag
 * coche d'un coup tous les potes qui le portent — sauf si TOUS ses
 * membres sont déjà cochés, auquel cas le clic les décoche tous (toggle
 * de groupe, symétrique à cocher/décocher une ligne individuelle).
 */
export function NotifyRecipientsField({
  potes,
  tags = [],
  fieldName = "notifyUserId",
  label = "Qui prévenir ?",
  onSelectionChange,
}: {
  potes: NotifyRecipientCandidate[];
  tags?: NotifyTagOption[];
  /** Roulette async (Sprint 3) réutilise ce même composant pour choisir les participants invités (`participantId`) plutôt que des destinataires de notif — le nom du champ posté doit donc rester paramétrable. */
  fieldName?: string;
  label?: string;
  /** Création de soirée : synchronise les destinataires avec les suggestions. */
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>(() => potes.map((p) => p.id));

  function select(ids: string[]) {
    setChecked(ids);
    onSelectionChange?.(ids);
  }

  function toggle(id: string) {
    select(checked.includes(id) ? checked.filter((c) => c !== id) : [...checked, id]);
  }

  function toggleTag(tagId: string) {
    const memberIds = potes.filter((p) => p.tagIds.includes(tagId)).map((p) => p.id);
    if (memberIds.length === 0) return;
    const allChecked = memberIds.every((id) => checked.includes(id));
    select(allChecked ? checked.filter((id) => !memberIds.includes(id)) : [...new Set([...checked, ...memberIds])]);
  }

  if (potes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {label} ({checked.length}/{potes.length})
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => select(potes.map((p) => p.id))}
            className="text-xs font-medium text-accent hover:underline"
          >
            Tout sélectionner
          </button>
          <button
            type="button"
            onClick={() => select([])}
            className="text-xs font-medium text-accent hover:underline"
          >
            Tout désélectionner
          </button>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: `color-mix(in srgb, ${tag.color} 15%, transparent)`,
                borderColor: `color-mix(in srgb, ${tag.color} 50%, transparent)`,
                color: tag.color,
              }}
            >
              🏷️ {tag.name}
            </button>
          ))}
        </div>
      )}

      <Stagger className="flex flex-col gap-1.5">
        {potes.map((pote) => {
          const isChecked = checked.includes(pote.id);
          return (
            <StaggerItem key={pote.id}>
              <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name={fieldName}
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
