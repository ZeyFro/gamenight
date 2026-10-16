"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sessionSeatAction } from "@/app/sessions/actions/seats";
import type { SeatCommand } from "@/lib/session-seats";
import type { SeatStatus } from "@/lib/session-seat-plan";

const messages = { access: "Tu n’as plus accès à cette soirée.", closed: "Les inscriptions sont fermées.", disabled: "L’organisateur doit d’abord activer la gestion des places.", capacity: "La capacité doit respecter le jeu et conserver les places déjà confirmées.", authentication: "Reconnecte-toi pour répondre.", rate_limited: "Trop de demandes rapprochées. Réessaie dans un instant.", unavailable: "La réponse n’a pas pu être enregistrée. Réessaie : elle ne créera pas de doublon." };
export function SessionSeatsPanel({ sessionId, userId, isCreator, open, capacity, maxPlayers, seats }: {
  sessionId: string; userId: string; isCreator: boolean; open: boolean; capacity: number | null; maxPlayers: number | null;
  seats: { userId: string; status: SeatStatus; user: { discordName: string } }[];
}) {
  const router = useRouter();
  const [limit, setLimit] = useState(capacity ?? Math.min(maxPlayers ?? 8, 100));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const confirmed = seats.filter(seat => seat.status === "CONFIRMED");
  const queue = seats.filter(seat => seat.status === "WAITLIST");
  const mine = seats.find(seat => seat.userId === userId);
  const position = queue.findIndex(seat => seat.userId === userId) + 1;
  async function respond(command: SeatCommand) {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice("");
    try {
      const result = await sessionSeatAction({ sessionId, command });
      if (!result.ok) setNotice(messages[result.error]);
      else {
        setNotice(command.kind === "capacity" ? "Capacité enregistrée." : result.status === "CONFIRMED" ? "Ta place est confirmée." : result.status === "WAITLIST" ? "Tu es dans la liste d’attente." : command.kind === "leave" ? "Ton désistement est enregistré." : "Liste actualisée.");
        router.refresh();
      }
    } catch { setNotice(messages.unavailable); }
    finally { busy.current = false; setPending(false); }
  }
  const button = "rounded-lg border border-accent/40 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50";
  return <section aria-labelledby="seats-title" aria-busy={pending} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
    <h2 id="seats-title" className="font-semibold">🎮 Places et liste d’attente</h2>
    {capacity === null ? <p className="text-sm text-muted">Sans limite de places · {confirmed.length} confirmé{confirmed.length === 1 ? "" : "s"}. Les membres invités qui répondent sont confirmés.</p> : <p className="text-sm"><strong>{confirmed.length}/{capacity} places confirmées</strong> · {queue.length} en attente</p>}
    <p className="text-sm text-muted">{mine?.status === "CONFIRMED" ? "Tu as une place." : mine?.status === "WAITLIST" ? `Ta position : ${position}.` : "Tu n’es pas inscrit."}</p>
    {confirmed.length > 0 && <p className="text-xs text-muted">Confirmés : {confirmed.map(seat => seat.user.discordName).join(", ")}</p>}
    {queue.length > 0 && <ol aria-label="Ordre de la liste d’attente" className="list-inside list-decimal text-xs text-muted">{queue.map(seat => <li key={seat.userId}>{seat.user.discordName}</li>)}</ol>}
    {open && <div className="flex flex-wrap gap-2">
      {mine?.status === "CONFIRMED" || mine?.status === "WAITLIST" ? <button type="button" className={button} disabled={pending} onClick={() => respond({ kind: "leave" })}>Me désister</button> : <button type="button" className={button} disabled={pending} onClick={() => respond({ kind: "join" })}>{capacity !== null && confirmed.length >= capacity ? "Rejoindre la liste d’attente" : "Je participe"}</button>}
    </div>}
    {!open && <p className="text-xs text-muted">Inscriptions fermées.</p>}
    {isCreator && open && <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1"><label htmlFor="seat-capacity" className="text-xs text-muted">Nombre de places</label><input id="seat-capacity" type="number" min={1} max={Math.min(maxPlayers ?? 100, 100)} value={limit} onChange={event => setLimit(Number(event.target.value))} disabled={pending} className="w-24 rounded-lg border border-border bg-background p-2" /></div>
      <button type="button" className={button} disabled={pending} onClick={() => respond({ kind: "capacity", capacity: limit })}>{capacity === null ? "Activer les places" : "Modifier la capacité"}</button>
      {capacity !== null && <button type="button" className={button} disabled={pending} onClick={() => respond({ kind: "refresh" })}>Actualiser la file</button>}
    </div>}
    {capacity !== null && <p className="text-xs text-muted">Une place libérée va au premier invité encore autorisé dans la file. Une nouvelle inscription après désistement repart à la fin.</p>}
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
  </section>;
}
