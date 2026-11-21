/**
 * Suppression et export de compte (docs/SUPPRESSION_COMPTE.md). Derrière le drapeau `ACCOUNT_DELETION_ENABLED`
 * (éteint par défaut, actif uniquement si la valeur vaut exactement `true`). Éteint, la page `/profil/compte`,
 * l'export et l'action de suppression refusent CÔTÉ SERVEUR (404 ou refus explicite) et le lien n'apparaît pas.
 * Exige la migration `20261121100000_account_deletion_log` (journal) : sans elle la suppression échoue sans rien écrire.
 */
export function isAccountDeletionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ACCOUNT_DELETION_ENABLED === "true";
}

/** Mot à saisir (ou pseudo exact) pour confirmer la suppression. */
export const ACCOUNT_DELETION_CONFIRM_WORD = "SUPPRIMER";

/** Confirmation forte : le pseudo exact ou le mot « SUPPRIMER » (casse respectée pour le mot). Pure. */
export function isAccountDeletionConfirmed(input: string, discordName: string): boolean {
  const typed = input.trim();
  if (typed.length === 0) return false;
  return typed === ACCOUNT_DELETION_CONFIRM_WORD || typed === discordName.trim();
}
