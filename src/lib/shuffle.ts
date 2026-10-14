/**
 * Mélange Fisher-Yates (ne mute pas le tableau d'entrée). Utilisé par les
 * backfills coop (`backfill-igdb-coop.ts`/`backfill-steam-coop.ts`, PR
 * "Optimisation build") pour répartir aléatoirement l'ordre de traitement
 * à chaque appel : sans marqueur de progression persisté (pas de nouvelle
 * migration pour ça), un ordre fixe retraiterait toujours les mêmes
 * premiers jeux si un appel s'arrête avant la fin de la liste — mélanger
 * garantit qu'un jeu resté "à faire" finisse par être traité en répétant
 * les appels (cron quotidien ou déclenchement manuel), sans jamais rester
 * bloqué en fin de liste indéfiniment.
 */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
