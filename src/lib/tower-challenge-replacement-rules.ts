/**
 * Remplacement d'un défi solo dont le jeu n'est pas possédé (cahier 8.5-8.6 : « aucun achat de jeu ne doit être
 * obligatoire »). Règles pures. OFF par défaut : actif seulement si la valeur vaut exactement `true`.
 */
export function isTowerChallengeReplacementEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOWER_CHALLENGE_REPLACEMENT_ENABLED === "true";
}

export type ReplacementBlock =
  | "not_assigned" | "team" | "expired" | "no_game_required" | "game_owned" | "already_replaced";

export type ReplaceableAttempt = {
  status: string;
  teamId: string | null;
  expiresAt: Date;
  /** Jeu exigé par la définition attribuée (`TowerChallengeDefinition.gameId`), `null` si aucun. */
  requiredGameId: string | null;
  alreadyReplaced: boolean;
};

/**
 * Un défi se remplace seulement s'il est solo, encore à réaliser (aucune preuve déposée), non expiré, qu'il
 * exige un jeu que le joueur ne possède pas, et qu'il n'a pas déjà été remplacé (une seule fois).
 */
export function towerReplacementBlock(attempt: ReplaceableAttempt, ownedGameIds: ReadonlySet<string>, current: Date): ReplacementBlock | null {
  if (attempt.teamId !== null) return "team";
  if (attempt.status !== "ASSIGNED") return "not_assigned";
  if (attempt.expiresAt.getTime() <= current.getTime()) return "expired";
  if (attempt.requiredGameId === null) return "no_game_required";
  if (ownedGameIds.has(attempt.requiredGameId)) return "game_owned";
  if (attempt.alreadyReplaced) return "already_replaced";
  return null;
}

export type ReplacementCandidate = { id: string; rewardFloors: number; gameId: string | null };

/**
 * Défi équivalent : même nombre d'étages (donc même difficulté), différent du défi remplacé, sans jeu exigé ou
 * avec un jeu possédé ; on préfère un défi jamais tenté. `random` renvoie un entier dans [0, n).
 */
export function pickReplacementDefinition<T extends ReplacementCandidate>(
  candidates: readonly T[],
  input: { currentId: string; rewardFloors: number; ownedGameIds: ReadonlySet<string>; seenIds: ReadonlySet<string> },
  random: (n: number) => number,
): T | null {
  const eligible = candidates.filter(candidate => candidate.id !== input.currentId
    && candidate.rewardFloors === input.rewardFloors
    && (candidate.gameId === null || input.ownedGameIds.has(candidate.gameId)));
  if (!eligible.length) return null;
  const unseen = eligible.filter(candidate => !input.seenIds.has(candidate.id));
  const pool = unseen.length ? unseen : eligible;
  return pool[random(pool.length)] ?? null;
}
