/**
 * Compte à rebours d'une session « Jouer maintenant ».
 *
 * Le serveur calcule `timeRemainingMs` avec SA convention d'horloge (heure
 * murale Paris, voir `src/lib/wallclock.ts`). Ce temps restant ne doit donc
 * jamais être recalculé côté navigateur à partir de `expiresAt` et de
 * `Date.now()` : les deux horloges ne sont pas dans la même convention, ce qui
 * ajoutait le décalage Paris (1 h en hiver, 2 h en été) au compteur affiché.
 *
 * On repart du temps restant serveur, puis on ne soustrait que le temps local
 * écoulé depuis la réception de cette valeur.
 */
export function instantSessionRemainingMs(input: {
  remainingAtLoadMs: number;
  loadedAtMs: number;
  nowMs: number;
  ended: boolean;
}): number {
  if (input.ended) return 0;
  const elapsed = Math.max(0, input.nowMs - input.loadedAtMs);
  return Math.max(0, input.remainingAtLoadMs - elapsed);
}
