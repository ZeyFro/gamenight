"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { reloadPage } from "@/lib/page-reload";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

// Côté serveur, aucun bandeau : le rendu initial reste identique au HTML
// pré-rendu, même si l'appareil est hors ligne au chargement (le cas est
// alors couvert par la page statique `/offline.html`).
function getServerSnapshot() {
  return true;
}

/**
 * L7-13 — bandeau de réseau. Il ne déclenche aucune action à la place du
 * joueur : au retour de la connexion, il propose « Recharger » et laisse le
 * clic décider. Aucune donnée n'est lue ni stockée ici.
 */
export function OfflineBanner({ raised = false }: { raised?: boolean } = {}) {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const handleOnline = () => setRestored(true);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  if (online && !restored) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2 text-xs text-foreground shadow-lg ${
        raised ? "bottom-[calc(56px+env(safe-area-inset-bottom))] lg:bottom-0" : "bottom-0"
      }`}
    >
      <span>
        {online ? "Connexion retrouvée." : "Hors ligne — les pages non encore ouvertes sont indisponibles."}
      </span>
      {online && (
        <button
          type="button"
          onClick={() => reloadPage()}
          className="gn-touch-target relative shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-accent hover:border-accent"
        >
          Recharger
        </button>
      )}
    </div>
  );
}
