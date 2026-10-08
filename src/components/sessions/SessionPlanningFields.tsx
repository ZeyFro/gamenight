"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { NotifyRecipientsField, type NotifyRecipientCandidate, type NotifyTagOption } from "@/components/NotifyRecipientsField";
import { suggestSessionSlotsAction } from "@/app/sessions/actions/suggest-slots";
import type { SlotSuggestionsResult } from "@/lib/session-slot-data";
import { formatDateTimeFr, parseDateAndTime } from "@/lib/wallclock";

const errors = {
  authentication: "Reconnecte-toi pour chercher un créneau.",
  invalid_input: "Vérifie la durée et les personnes choisies.",
  participants_changed: "La liste des membres a changé. Recharge cette page avant de rechercher.",
  rate_limited: "Trop de recherches rapprochées. Réessaie dans quelques secondes.",
  unavailable: "Les disponibilités n’ont pas pu être chargées. Réessaie dans un instant.",
};
const inputClass = "min-w-0 rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SessionPlanningFields({ potes, tags, minDate, initialDate = "", initialTime = "" }: {
  potes: NotifyRecipientCandidate[];
  tags: NotifyTagOption[];
  minDate: string;
  initialDate?: string;
  initialTime?: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [guestIds, setGuestIds] = useState(() => potes.map((pote) => pote.id));
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [result, setResult] = useState<SlotSuggestionsResult | null>(null);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);

  function changeGuests(ids: string[]) {
    sequence.current++; setGuestIds(ids); setResult(null);
  }
  async function search() {
    if (busy.current) return;
    busy.current = true;
    const current = ++sequence.current;
    setPending(true); setResult(null);
    try {
      const response = await suggestSessionSlotsAction({ guestIds, durationMinutes });
      if (sequence.current === current) setResult(response);
    } catch {
      if (sequence.current === current) setResult({ ok: false, error: "unavailable" });
    } finally {
      busy.current = false; setPending(false);
    }
  }

  return <>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1"><label className="text-xs text-muted" htmlFor="session-date">Date</label><input id="session-date" type="date" name="date" required min={minDate} value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></div>
      <div className="flex min-w-0 flex-col gap-1"><label className="text-xs text-muted" htmlFor="session-time">Heure</label><input id="session-time" type="time" name="time" required value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} /></div>
    </div>
    <NotifyRecipientsField potes={potes} tags={tags} onSelectionChange={changeGuests} />
    <section className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4" aria-labelledby="slot-suggestions-title" aria-busy={pending}>
      <h3 id="slot-suggestions-title" className="text-sm font-semibold">✦ Trouver le bon créneau</h3>
      <p className="text-xs leading-relaxed text-muted">Pour toi et les personnes cochées, sur les 7 prochains jours. Départs entre 18 h et 23 h 30.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1"><label htmlFor="suggestion-duration" className="text-xs text-muted">Durée à trouver</label><select id="suggestion-duration" value={durationMinutes} onChange={(event) => { sequence.current++; setDurationMinutes(Number(event.target.value)); setResult(null); }} className={inputClass}><option value={60}>1 h</option><option value={90}>1 h 30</option><option value={120}>2 h</option><option value={180}>3 h</option></select></div>
        <button type="button" disabled={pending} onClick={search} className="rounded-lg border border-accent/40 px-3 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50">{pending ? "Recherche…" : "Proposer des créneaux"}</button>
      </div>
      {pending && <p role="status" className="text-xs text-muted">Recherche des disponibilités…</p>}
      {result && !result.ok && <p role="alert" className="text-xs text-destructive">{errors[result.error]}</p>}
      {result?.ok && <div aria-live="polite" className="flex flex-col gap-2">
        {result.suggestions.length === 0 ? <p className="text-xs text-muted">Aucun créneau trouvé pour cette durée. Essaie une durée plus courte ou complète les disponibilités.</p> : result.suggestions.map((slot) => <button key={`${slot.date}-${slot.time}`} type="button" aria-pressed={date === slot.date && time === slot.time} onClick={() => { setDate(slot.date); setTime(slot.time); }} className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3 text-left text-xs transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent/10">
          <span className="font-semibold capitalize">{formatDateTimeFr(parseDateAndTime(slot.date, slot.time))}</span>
          <span className="text-accent">{slot.availableCount}/{slot.totalParticipants} disponibles jusqu’à {slot.endTime}{slot.endDate !== slot.date ? " le lendemain" : ""}</span>
          {slot.unknownCount > 0 && <span className="text-muted">{slot.unknownCount} personne{slot.unknownCount > 1 ? "s" : ""} sans disponibilité renseignée{!slot.creatorAvailable ? " · toi aussi, à confirmer" : ""}</span>}
        </button>)}
        <p className="text-xs text-muted">Choisir remplit la date et l’heure. La présence reste à confirmer ; la soirée n’est pas créée.</p>
      </div>}
      <Link href="/disponibilites" prefetch={false} className="text-xs font-medium text-accent hover:underline">Renseigner mes disponibilités →</Link>
    </section>
  </>;
}
