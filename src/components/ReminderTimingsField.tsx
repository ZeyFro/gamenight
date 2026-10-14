"use client";

import { useState } from "react";
import {
  DEFAULT_REMINDER_TIMINGS,
  MAX_REMINDERS_PER_SESSION,
  REMINDER_PRESETS,
} from "@/lib/reminder-timings";

interface CustomRow {
  id: string;
}

/**
 * Champ "Rappels" du formulaire de création de soirée (PR 31, 2/4 —
 * Bloc A). 8 préréglages en cases à cocher (24h par défaut cochés, même
 * comportement F7 qu'avant cette PR) + rappels custom (nombre + unité).
 * Max `MAX_REMINDERS_PER_SESSION` au total, appliqué ici côté UI
 * (désactive les options restantes) et revérifié côté serveur
 * (`parseReminderTimingsFromFormData` tronque silencieusement au-delà).
 *
 * Les valeurs custom (nombre/unité) restent des champs non contrôlés —
 * seule la LISTE de lignes custom (ajout/retrait) est en state React ;
 * leurs valeurs sont lues directement depuis le FormData à la
 * soumission, pas besoin d'un `onChange` par champ pour un simple
 * formulaire de création.
 */
export function ReminderTimingsField() {
  const [checked, setChecked] = useState<number[]>(DEFAULT_REMINDER_TIMINGS);
  const [customs, setCustoms] = useState<CustomRow[]>([]);

  const total = checked.length + customs.length;
  const atMax = total >= MAX_REMINDERS_PER_SESSION;

  function toggle(minutes: number) {
    setChecked((prev) =>
      prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes]
    );
  }

  function addCustom() {
    if (atMax) return;
    setCustoms((prev) => [...prev, { id: `custom-${Date.now()}-${prev.length}` }]);
  }

  function removeCustom(id: string) {
    setCustoms((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted">
        Rappels ({total}/{MAX_REMINDERS_PER_SESSION})
      </span>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {REMINDER_PRESETS.map((preset) => {
          const isChecked = checked.includes(preset.minutes);
          const disabled = !isChecked && atMax;
          return (
            <label
              key={preset.minutes}
              className={`flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground ${
                disabled ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                name="reminderPreset"
                value={preset.minutes}
                checked={isChecked}
                disabled={disabled}
                onChange={() => toggle(preset.minutes)}
                className="h-5 w-5 shrink-0 rounded border-border accent-accent"
              />
              {preset.label}
            </label>
          );
        })}
      </div>

      {customs.map((custom) => (
        <div key={custom.id} className="flex items-center gap-2">
          <input
            type="number"
            name="reminderCustomAmount"
            min={1}
            required
            placeholder="Nombre"
            className="w-24 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <select
            name="reminderCustomUnit"
            defaultValue="heures"
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="minutes">minutes avant</option>
            <option value="heures">heures avant</option>
            <option value="jours">jours avant</option>
          </select>
          <button
            type="button"
            onClick={() => removeCustom(custom.id)}
            aria-label="Retirer ce rappel custom"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-destructive"
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addCustom}
        disabled={atMax}
        className="self-start text-xs font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
      >
        + Ajouter un rappel custom
      </button>
      {atMax && (
        <p className="text-xs text-muted">
          Maximum {MAX_REMINDERS_PER_SESSION} rappels par soirée.
        </p>
      )}
    </div>
  );
}
