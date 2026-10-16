"use client";
import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { setGameRefusalAction } from "@/app/profil/game-preference-actions";

function SubmitRefusal({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={!enabled || pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">{pending ? "Enregistrement…" : "Refuser ce jeu"}</button>;
}
export function RefuseGameForm({ games }: { games: Array<{ id: string; name: string }> }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const id = useId();
  const matching = useMemo(() => games.filter(game => game.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"))), [games, query]);
  return <form action={setGameRefusalAction} className="flex flex-col gap-2">
    <input type="hidden" name="mode" value="refuse" />
    <label htmlFor={`${id}-search`} className="text-sm font-medium">Chercher dans les jeux du serveur</label>
    <input id={`${id}-search`} type="search" value={query} onChange={event => { setQuery(event.target.value); setSelected(""); }} className="rounded-lg border border-border bg-background px-3 py-2" />
    <label htmlFor={`${id}-game`} className="text-sm font-medium">Jeu à refuser</label>
    <select id={`${id}-game`} name="gameId" required value={selected} onChange={event => setSelected(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2">
      <option value="">Choisir un jeu</option>
      {matching.slice(0, 100).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
    </select>
    {matching.length > 100 && <p className="text-xs text-muted">Les 100 premiers résultats sont affichés. Affine ta recherche pour trouver un autre jeu.</p>}
    {!matching.length && <p className="text-xs text-muted">Aucun jeu correspondant dans la bibliothèque de ce serveur.</p>}
    <SubmitRefusal enabled={!!selected} />
  </form>;
}
