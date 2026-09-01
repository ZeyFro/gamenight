"use client";

import { useTransition } from "react";

/**
 * Bandeau d'erreur API réutilisable (Sprint 1 fiabilisation — audit des
 * appels Steam/IGDB/Discord/DeepL externes). Composant purement présentatif
 * et sans état propre : c'est l'appelant qui décide quand l'afficher (son
 * propre état d'erreur) — le bandeau "disparaît automatiquement si le
 * retry fonctionne" simplement parce que l'appelant arrête de le rendre
 * une fois son erreur résolue (pas de logique de dismiss interne ici).
 *
 * `onRetry` accepte aussi bien une fonction cliente locale (ex.
 * `AjouterJeuForm` qui relance son `fetch`) qu'une server action passée
 * en prop depuis un composant serveur (même pattern que `ActionForm.tsx`)
 * — les deux ont la même signature `() => void | Promise<void>`.
 */
export function ApiErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    if (!onRetry) return;
    startTransition(async () => {
      await onRetry();
    });
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
    >
      <span aria-hidden className="shrink-0">
        ⚠️
      </span>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={isPending}
          className="shrink-0 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/15 disabled:opacity-50"
        >
          {isPending ? "…" : "Réessayer"}
        </button>
      )}
    </div>
  );
}
