/**
 * Traitement par lots à concurrence réellement bornée (fix "cron Steam
 * surdimensionné") — `Promise.allSettled(items.map(worker))` démarre TOUTES
 * les promesses d'un coup, ce qui n'impose aucune limite de concurrence
 * malgré les apparences. Ici, un lot entier est intégralement réglé avant
 * que le suivant ne démarre : jamais plus de `batchSize` exécutions actives
 * simultanément, à aucun moment.
 *
 * `results` conserve le même ordre que `items` en entrée — garantie native
 * de `Promise.allSettled` (l'ordre du tableau de résultats correspond à
 * l'ordre du tableau de promesses fourni, indépendamment de l'ordre de
 * résolution réel) — déterministe même si un élément d'un lot se résout
 * avant un autre du même lot.
 *
 * `shouldContinue` (optionnel), vérifié avant CHAQUE lot (y compris le
 * premier) : retourne `false` pour arrêter immédiatement et laisser les
 * éléments restants non traités — sert de filet de sécurité de budget de
 * temps aux appelants (ex. `steam-library-sync`), sans coupler cette
 * fonction générique à une notion de délai particulière.
 */

export interface ProcessInBatchesOptions {
  shouldContinue?: () => boolean;
}

export interface ProcessInBatchesResult<R> {
  results: PromiseSettledResult<R>[];
  /** Nombre d'éléments réellement soumis au `worker` (< items.length si `shouldContinue` a arrêté le traitement en cours de route). */
  processedCount: number;
}

export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
  options?: ProcessInBatchesOptions
): Promise<ProcessInBatchesResult<R>> {
  const results: PromiseSettledResult<R>[] = [];
  let processedCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    if (options?.shouldContinue && !options.shouldContinue()) break;

    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(worker));
    results.push(...batchResults);
    processedCount += batch.length;
  }

  return { results, processedCount };
}
