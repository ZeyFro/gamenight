/**
 * Rechargement explicite de la page (bouton « Recharger » du bandeau hors
 * ligne). Isolé dans ce module pour que le composant reste testable : jsdom
 * refuse de remplacer `window.location.reload`.
 */
export function reloadPage() {
  window.location.reload();
}
