import type { InstantSessionActionFailureReason } from "@/lib/instant-sessions";

/**
 * État renvoyé par les server actions de "Jouer maintenant" (`useActionState`).
 *
 * Volontairement HORS de `actions.ts` : un fichier `"use server"` ne peut
 * exporter QUE des fonctions async — toute autre valeur (comme la constante
 * ci-dessous) fait lever à Next, à l'évaluation du module, « A "use server"
 * file can only export async functions » → HTTP 500 pour TOUTES les actions
 * du fichier, avant la moindre ligne de code. Les types, eux, sont effacés
 * à la compilation et peuvent rester côté actions.
 */
export interface InstantSessionActionState {
  status: "idle" | "success" | "error";
  errorReason?: InstantSessionActionFailureReason | "validation" | "rate_limited";
}

export const INITIAL_INSTANT_SESSION_ACTION_STATE: InstantSessionActionState = { status: "idle" };
