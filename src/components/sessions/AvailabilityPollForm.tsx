"use client";

import { useRef, useState } from "react";
import { CreationForm } from "@/components/CreationForm";
import { NotifyRecipientsField, type NotifyRecipientCandidate } from "@/components/NotifyRecipientsField";
import { createAvailabilityPollAction } from "@/app/sessions/actions/availability-polls";
import { suggestSessionSlotsAction } from "@/app/sessions/actions/suggest-slots";
import type { SlotSuggestionsResult } from "@/lib/session-slot-data";
import { formatDateTimeFr, parseDateAndTime } from "@/lib/wallclock";

const fieldClass = "min-w-0 rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
type Option = { id: number; date: string; time: string; duration: string };

export function AvailabilityPollForm({ participants, minDate }: { participants: NotifyRecipientCandidate[]; minDate: string }) {
  const [options, setOptions] = useState<Option[]>([
    { id: 1, date: "", time: "20:00", duration: "120" },
    { id: 2, date: "", time: "20:00", duration: "120" },
  ]);
  const [participantIds, setParticipantIds] = useState(() => participants.map(row => row.id));
  const [suggestions, setSuggestions] = useState<SlotSuggestionsResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [duration, setDuration] = useState(120);
  const searchSequence = useRef(0);
  function changeParticipants(ids: string[]) {
    searchSequence.current++;
    setSearching(false);
    setParticipantIds(ids);
    setSuggestions(null);
  }
  async function findSuggestions() {
    const sequence = ++searchSequence.current;
    setSearching(true);
    try {
      const result = await suggestSessionSlotsAction({ guestIds: participantIds, durationMinutes: duration });
      if (searchSequence.current === sequence) setSuggestions(result);
    } catch {
      if (searchSequence.current === sequence) setSuggestions({ ok: false, error: "unavailable" });
    } finally {
      if (searchSequence.current === sequence) setSearching(false);
    }
  }
  function applySuggestion(date: string, time: string) {
    setOptions(rows => {
      const index = rows.findIndex(row => !row.date);
      if (index < 0 && rows.length < 28) return [...rows, { id: Math.max(...rows.map(row => row.id)) + 1, date, time, duration: String(duration) }];
      const target = index < 0 ? 0 : index;
      return rows.map((row, rowIndex) => rowIndex === target ? { ...row, date, time, duration: String(duration) } : row);
    });
  }
  return <CreationForm action={createAvailabilityPollAction} className="flex flex-col gap-5">
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor="poll-title">Nom de la préparation</label>
      <input id="poll-title" name="title" required maxLength={120} className={fieldClass} placeholder="Soirée jeux de novembre" />
    </div>
    <NotifyRecipientsField potes={participants} fieldName="participantId" label="Qui participe au choix ?" onSelectionChange={changeParticipants} />
    <section className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <h2 className="font-semibold">Suggestions selon les plannings renseignés</h2>
      <p className="text-xs text-muted">Elles consultent les disponibilités hebdomadaires et ponctuelles choisies par chacun. Elles restent indicatives et ne comptent jamais comme des réponses au sondage.</p>
      <div className="flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1 text-xs text-muted">Durée<select value={duration} onChange={event => { searchSequence.current++; setSearching(false); setDuration(Number(event.target.value)); setSuggestions(null); }} className={fieldClass}><option value={60}>1 h</option><option value={90}>1 h 30</option><option value={120}>2 h</option><option value={180}>3 h</option></select></label><button type="button" disabled={searching} onClick={findSuggestions} className="rounded-lg border border-accent/40 px-3 py-3 text-sm font-semibold text-accent disabled:opacity-50">{searching ? "Recherche…" : "Chercher des créneaux"}</button></div>
      {suggestions && !suggestions.ok && <p role="alert" className="text-xs text-destructive">{suggestions.error === "participants_changed" ? "La liste des membres a changé. Recharge la page." : suggestions.error === "rate_limited" ? "Trop de recherches rapprochées, réessaie bientôt." : "Suggestions indisponibles pour le moment."}</p>}
      {suggestions?.ok && <ul className="flex flex-col gap-2" aria-live="polite">{suggestions.suggestions.length ? suggestions.suggestions.map(slot => <li key={`${slot.date}-${slot.time}`}><button type="button" disabled={options.length >= 28 && options.every(row => row.date)} onClick={() => applySuggestion(slot.date, slot.time)} className="flex w-full flex-col rounded-lg border border-border bg-background p-3 text-left text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"><span className="font-medium capitalize">{formatDateTimeFr(parseDateAndTime(slot.date, slot.time))}</span><span className="text-xs text-muted">{slot.availableCount}/{slot.totalParticipants} disponibles · {slot.unknownCount} sans planning · ajouter comme option</span></button></li>) : <li className="text-xs text-muted">Aucun créneau suggéré. Tu peux toujours saisir tes options manuellement.</li>}</ul>}
    </section>
    <section className="flex flex-col gap-3" aria-labelledby="poll-options-title">
      <div>
        <h2 id="poll-options-title" className="font-semibold">Créneaux à comparer</h2>
        <p className="text-xs text-muted">Les disponibilités enregistrées peuvent guider votre choix, mais elles ne répondent jamais à la place des participants.</p>
      </div>
      {options.map((option, index) => <fieldset key={option.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <legend className="px-1 text-xs text-muted">Option {index + 1}</legend>
        <label className="flex flex-col gap-1 text-xs text-muted">Date<input aria-label={`Date option ${index + 1}`} type="date" name="optionDate" value={option.date} min={minDate} required onChange={event => setOptions(rows => rows.map(row => row.id === option.id ? { ...row, date: event.target.value } : row))} className={fieldClass} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Heure<input aria-label={`Heure option ${index + 1}`} type="time" name="optionTime" value={option.time} required onChange={event => setOptions(rows => rows.map(row => row.id === option.id ? { ...row, time: event.target.value } : row))} className={fieldClass} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Durée<select aria-label={`Durée option ${index + 1}`} name="optionDuration" value={option.duration} onChange={event => setOptions(rows => rows.map(row => row.id === option.id ? { ...row, duration: event.target.value } : row))} className={fieldClass}><option value="60">1 h</option><option value="90">1 h 30</option><option value="120">2 h</option><option value="180">3 h</option></select></label>
        {options.length > 2 && <button type="button" onClick={() => setOptions(rows => rows.filter(row => row.id !== option.id))} aria-label={`Supprimer option ${index + 1}`} className="self-end rounded-lg px-3 py-3 text-sm text-destructive hover:bg-destructive/10">Supprimer</button>}
      </fieldset>)}
      {options.length < 28 && <button type="button" onClick={() => setOptions(rows => [...rows, { id: Math.max(...rows.map(row => row.id)) + 1, date: "", time: "20:00", duration: "120" }])} className="self-start rounded-lg border border-border px-3 py-2 text-sm font-medium hover:border-accent">Ajouter un créneau</button>}
    </section>
    <button type="submit" className="rounded-lg bg-accent px-4 py-3 font-semibold text-white hover:opacity-90">Créer le sondage privé</button>
  </CreationForm>;
}
