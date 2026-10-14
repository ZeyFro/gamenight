"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enrichGamesForCoopFilter } from "@/app/bibliotheque/actions";

/** Limite le lot enrichi en un passage — "progressif", pas d'explosion de requêtes IGDB si toute la biblio manque de cache. */
const MAX_BATCH = 15;

/**
 * Bandeau + déclenchement de l'enrichissement IGDB à la demande (PR 32,
 * 2.5/4 — Bug 2B). Rendu par `/bibliotheque` : ne fait quelque chose que
 * si `active` (filtre Coop appliqué) et qu'il reste des jeux sans cache
 * IGDB dans la biblio. `router.refresh()` une fois terminé pour que la
 * liste filtrée se recalcule côté serveur avec les `isCoop` fraîchement
 * synchronisés.
 */
export function CoopEnrichmentTrigger({
  active,
  gameIds,
}: {
  active: boolean;
  gameIds: string[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const startedForKey = useRef<string | null>(null);

  const batch = gameIds.slice(0, MAX_BATCH);
  const batchKey = batch.join(",");

  useEffect(() => {
    if (!active || batch.length === 0 || done) return;
    if (startedForKey.current === batchKey) return;
    startedForKey.current = batchKey;

    let cancelled = false;
    setRunning(true);

    enrichGamesForCoopFilter(batch).finally(() => {
      if (cancelled) return;
      setRunning(false);
      setDone(true);
      router.refresh();
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `batch`/`batchKey` dérivés de `gameIds` à chaque rendu, la garde `startedForKey` gère la stabilité.
  }, [active, batchKey, done]);

  if (!active || batch.length === 0 || done) return null;

  return (
    <p className="flex items-center gap-2 rounded-lg bg-accent/10 p-3 text-sm text-accent">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      {running
        ? `Enrichissement de ${batch.length} jeu${batch.length > 1 ? "x" : ""} pour le filtre Coop…`
        : "Préparation de l'enrichissement…"}
    </p>
  );
}
