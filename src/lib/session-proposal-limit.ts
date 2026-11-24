/**
 * Plafond de propositions de jeu par soirée (audit du 23/11/2026, constat 1.10). Valeur proposée, à valider : 10. Avant ce plafond,
 * un créateur ajoutait autant de propositions qu'il voulait puis les votait, à 5 XP chacune. Une soirée normale en a quelques-unes :
 * le plafond ne change rien tant qu'on reste à 10 jeux ou moins. Seul `proposeGame` (ajout par un membre) est concerné ; la
 * proposition posée à la création d'une soirée (jeu présélectionné, commande Discord, roulette) est la première et unique.
 */
export const MAX_PROPOSALS_PER_SESSION = 10;

export const PROPOSAL_LIMIT_MESSAGE =
  `Cette soirée a déjà ${MAX_PROPOSALS_PER_SESSION} jeux proposés, c'est le maximum. Vote pour l'un d'eux, ou demande à son auteur de retirer sa proposition.`;

/** Vrai quand la soirée a déjà atteint le maximum : la proposition suivante est refusée. */
export function isProposalLimitReached(existingProposals: number): boolean {
  return existingProposals >= MAX_PROPOSALS_PER_SESSION;
}
