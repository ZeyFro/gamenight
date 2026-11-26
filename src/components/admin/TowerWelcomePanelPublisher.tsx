"use client";

import { useState } from "react";

const CONFIRMATION = "PUBLIER_PANNEAU_TOWER";

export default function TowerWelcomePanelPublisher({ enabled }: { enabled: boolean }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function publish() {
    if (!enabled || busy || confirmation !== CONFIRMATION) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/tower-onboarding-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmation }),
      });
      const result = await response.json() as { ok?: boolean; alreadyPublished?: boolean; error?: string };
      if (!response.ok) {
        setStatus(`Publication refusée : ${result.error ?? response.status}.`);
      } else if (result.alreadyPublished) {
        setStatus("Le panneau existe déjà dans le salon d'accueil; aucun doublon n'a été envoyé.");
      } else {
        setStatus("Panneau publié dans le salon d'accueil.");
      }
    } catch {
      setStatus("Résultat réseau incertain. Recharge la page avant de réessayer; le contrôle des doublons est automatique.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Installer le panneau d'accueil</h2>
        <p className="mt-2 text-sm text-muted">
          Une seule publication dans #👋・bienvenue. Le panneau existant ne sera ni remplacé ni supprimé.
          L'historique est vérifié avant l'envoi.
        </p>
      </div>
      {!enabled && <p role="status" className="text-sm text-amber-300">Configuration incomplète : active le flag et vérifie le serveur et le salon dans Vercel.</p>}
      <label className="block space-y-2 text-sm">
        <span>Saisis <code>{CONFIRMATION}</code> pour confirmer la publication.</span>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2"
          autoComplete="off"
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          aria-label="Confirmation de publication"
        />
      </label>
      <button
        type="button"
        className="rounded-md bg-accent px-4 py-2 font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!enabled || busy || confirmation !== CONFIRMATION}
        onClick={publish}
      >
        {busy ? "Vérification puis publication…" : "Publier le panneau"}
      </button>
      {status && <p role="status" aria-live="polite" className="text-sm">{status}</p>}
    </section>
  );
}
