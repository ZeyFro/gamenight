"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGameWarnings } from "@/app/jeux/warning-actions";
import type { GameWarningsData } from "@/lib/game-warnings";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export function GameWarningsForm({ game }: { game: GameWarningsData & { id: string } }) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer font-medium">Renseigner les avertissements et langues</summary>
    <p className="my-2 text-sm text-muted">Déclare uniquement ce que tu as vérifié. Choisis « Inconnu » ou laisse les langues vides pour effacer une information.</p>
    <form className="grid gap-3" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setNotice(""); setFailed(false);
      startTransition(async () => {
        try {
          const result = await updateGameWarnings(form);
          setFailed(!result.ok);
          setNotice(result.ok ? "Informations enregistrées." : result.error === "rate_limited" ? RATE_LIMIT_MESSAGE : result.error === "access" ? "Tu dois encore posséder ce jeu pour le modifier." : "Vérifie les choix et limite chaque champ de langues à 120 caractères.");
          if (result.ok) router.refresh();
        } catch { setFailed(true); setNotice("Enregistrement impossible. Réessaie plus tard."); }
      });
    }}>
      <input type="hidden" name="gameId" value={game.id} />
      {([{ key: "jumpscares", label: "Jumpscares" }, { key: "motionSickness", label: "Risque de mal des transports" }] as const).map(field => <div key={field.key} className="grid gap-1">
        <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
        <select id={`${id}-${field.key}`} name={field.key} disabled={pending} defaultValue={game[field.key] == null ? "unknown" : game[field.key] ? "present" : "absent"} className="rounded-lg border border-border bg-background p-2">
          <option value="unknown">Inconnu</option><option value="present">Présence signalée</option><option value="absent">Absence déclarée</option>
        </select>
      </div>)}
      {([{ key: "textLanguages", label: "Langues des textes" }, { key: "audioLanguages", label: "Langues de l’audio" }] as const).map(field => <div key={field.key} className="grid gap-1">
        <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
        <input id={`${id}-${field.key}`} name={field.key} defaultValue={game[field.key] ?? ""} maxLength={120} disabled={pending} placeholder="Ex. français, anglais" className="rounded-lg border border-border bg-background p-2" />
      </div>)}
      <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">{pending ? "Enregistrement…" : "Enregistrer les avertissements"}</button>
      {notice && <p role={failed ? "alert" : "status"}>{notice}</p>}
    </form>
  </details>;
}
