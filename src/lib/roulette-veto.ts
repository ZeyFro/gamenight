export type RouletteVetoError = "disabled" | "forbidden" | "closed" | "not_participant" | "already_vetoed" | "no_candidate";

/** Refus d'un veto de roulette (null = autorisé) : tirée, soirée planifiée et à venir, participant, pas déjà utilisé. */
export function rouletteVetoRefusal(s: {
  rouletteStatus: string;
  hasResultSession: boolean;
  sessionStatus: string;
  sessionDate: Date;
  isParticipant: boolean;
  alreadyVetoed: boolean;
  now: Date;
}): "closed" | "not_participant" | "already_vetoed" | null {
  if (s.rouletteStatus !== "DONE" || !s.hasResultSession || s.sessionStatus !== "SCHEDULED" || s.sessionDate <= s.now) return "closed";
  if (!s.isParticipant) return "not_participant";
  return s.alreadyVetoed ? "already_vetoed" : null;
}
