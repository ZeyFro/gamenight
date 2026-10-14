/**
 * Réglage "traînée du curseur" (design de fond) — cosmétique pur, pas
 * lié au compte (pas de colonne `User` dédiée) : stocké en `localStorage`
 * plutôt qu'en base, activé par défaut (opt-out) sur desktop uniquement
 * (`pointer: fine`, vérifié côté `CursorTrail`). `CURSOR_TRAIL_EVENT`
 * permet à `CursorTrail` de se resynchroniser immédiatement quand le
 * toggle change dans le même onglet — l'évènement natif `storage` ne se
 * déclenche que pour les AUTRES onglets.
 */
const STORAGE_KEY = "gamenight:cursor-trail-enabled";
export const CURSOR_TRAIL_EVENT = "gamenight:cursor-trail-preference-change";

export function isCursorTrailEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCursorTrailEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // localStorage indisponible (navigation privée stricte, quota) —
    // réglage cosmétique, pas bloquant de retomber sur le défaut au
    // prochain chargement.
  }
  window.dispatchEvent(new Event(CURSOR_TRAIL_EVENT));
}
