/** Veto au vote de jeu (drapeau `VOTE_VETO_ENABLED`, éteint par défaut, actif seulement si la valeur vaut exactement `true`). */
export function isVoteVetoEnabled(): boolean {
  return process.env.VOTE_VETO_ENABLED === "true";
}

/** Retire les propositions vetoées avant le choix du gagnant ou le tirage. */
export function excludeVetoed<T extends { id: string }>(proposals: T[], vetoedProposalIds: ReadonlySet<string>): T[] {
  return proposals.filter((p) => !vetoedProposalIds.has(p.id));
}

/**
 * Vrai si, une fois `candidateId` vetoée, il reste au moins un jeu jouable non vetoé.
 * `vetoedProposalIds` ne contient PAS l'ancien veto de l'acteur (un nouveau veto le remplace).
 */
export function wouldVetoLeaveCandidate(
  jouableProposalIds: string[],
  vetoedProposalIds: ReadonlySet<string>,
  candidateId: string
): boolean {
  return jouableProposalIds.some((id) => id !== candidateId && !vetoedProposalIds.has(id));
}
