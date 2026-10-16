"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGamePreparation } from "@/app/jeux/preparation-actions";
import type { GamePreparationData } from "@/lib/game-preparation";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export function GamePreparationForm({ game, estimatedTimeEnabled }: { game: Omit<GamePreparationData, "preparationUpdatedAt"> & { id: string }; estimatedTimeEnabled: boolean }) {
  const id = useId(); const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState(""); const [failed, setFailed] = useState(false);
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer font-medium">{estimatedTimeEnabled ? "Renseigner le coût, le téléchargement et la durée" : "Renseigner le coût et le téléchargement"}</summary>
    <p className="my-2 text-sm text-muted">Indique la plateforme/version et un lien vers ta source pour tout coût ou volume renseigné. Utilise le volume à télécharger, en Go (1 Go = un milliard d’octets), sans le remplacer par l’espace disque requis. Laisse vide pour rétablir l’inconnu.</p>
    <form className="grid gap-3" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setNotice(""); setFailed(false);
      startTransition(async () => {
        try {
          const result = await updateGamePreparation(form); setFailed(!result.ok);
          setNotice(result.ok ? "Relevé enregistré." : result.error === "rate_limited" ? RATE_LIMIT_MESSAGE : result.error === "access" ? "Tu dois encore posséder ce jeu pour le modifier." : result.error === "disabled" ? "Cette fonctionnalité est désactivée." : "Vérifie le coût, le volume (0,01 à 5 000 Go), la durée (1 à 10 080 minutes), la plateforme et le lien HTTPS vers la source. Un prix exige le statut payant.");
          if (result.ok) router.refresh();
        } catch { setFailed(true); setNotice("Enregistrement impossible. Réessaie plus tard."); }
      });
    }}>
      <input type="hidden" name="gameId" value={game.id} />
      <label htmlFor={`${id}-cost`}>Coût déclaré</label>
      <select id={`${id}-cost`} name="preparationCost" disabled={pending} defaultValue={game.preparationCost ?? "unknown"} className="rounded-lg border border-border bg-background p-2">
        <option value="unknown">Inconnu</option><option value="FREE">Gratuit</option><option value="PAID">Payant</option>
      </select>
      {([
        { key: "preparationPrice", label: "Prix et devise (si payant)", max: 120, type: "text", placeholder: "Ex. 19,99 EUR, prix de base" },
        { key: "preparationPlatform", label: "Plateforme / version", max: 80, type: "text", placeholder: "Ex. PC Windows, Steam, version 1.2" },
        { key: "preparationSourceUrl", label: "Source du relevé (HTTPS)", max: 500, type: "url", placeholder: "https://…" },
      ] as const).map(field => <div key={field.key} className="grid gap-1"><label htmlFor={`${id}-${field.key}`}>{field.label}</label><input id={`${id}-${field.key}`} name={field.key} type={field.type} maxLength={field.max} defaultValue={game[field.key] ?? ""} placeholder={field.placeholder} disabled={pending} className="rounded-lg border border-border bg-background p-2" /></div>)}
      <label htmlFor={`${id}-size`}>Téléchargement estimé (Go)</label>
      <input id={`${id}-size`} name="downloadSizeGb" type="number" min="0.01" max="5000" step="0.01" defaultValue={game.downloadSizeGb ?? ""} disabled={pending} className="rounded-lg border border-border bg-background p-2" />
      {estimatedTimeEnabled && <><label htmlFor={`${id}-time`}>Temps de préparation estimé (minutes)</label><input id={`${id}-time`} name="preparationTimeMinutes" type="number" min="1" max="10080" step="1" defaultValue={game.preparationTimeMinutes ?? ""} disabled={pending} className="rounded-lg border border-border bg-background p-2" /></>}
      <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">{pending ? "Enregistrement…" : "Enregistrer le relevé"}</button>
      {notice && <p role={failed ? "alert" : "status"}>{notice}</p>}
    </form>
  </details>;
}
