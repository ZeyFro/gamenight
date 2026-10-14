"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import {
  CURSOR_TRAIL_EVENT,
  isCursorTrailEnabled,
  setCursorTrailEnabled,
} from "@/lib/cursor-trail-preference";

function subscribe(callback: () => void) {
  window.addEventListener(CURSOR_TRAIL_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CURSOR_TRAIL_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Toggle "traînée du curseur" (design de fond) — réglage cosmétique
 * purement client (`localStorage`, pas de colonne `User`).
 * `useSyncExternalStore` plutôt qu'un `useState`+`useEffect` maison : lit
 * `localStorage` (jamais dispo côté serveur) de façon sûre pour
 * l'hydratation — `getServerSnapshot` fournit la valeur par défaut pour
 * le rendu serveur/premier rendu client, React se resynchronise ensuite
 * tout seul avec la vraie valeur sans mismatch, et se resouscrit à
 * `CURSOR_TRAIL_EVENT`/`storage` pour rester à jour si le réglage change
 * ailleurs (autre onglet, ou ce composant lui-même).
 */
export function CursorTrailToggle() {
  const enabled = useSyncExternalStore(subscribe, isCursorTrailEnabled, () => true);

  return (
    <Button
      type="button"
      variant="secondary"
      fullWidthOnMobile
      onClick={() => setCursorTrailEnabled(!enabled)}
    >
      {enabled ? "✨ Désactiver la traînée du curseur" : "✨ Activer la traînée du curseur"}
    </Button>
  );
}
