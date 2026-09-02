/**
 * Feedback haptique mobile (Sprint 2, U8) — `navigator.vibrate()`, API Web
 * standard supportée sur Android/Chrome, silencieusement absente sur
 * iOS/Safari et desktop (`typeof navigator.vibrate !== "function"`) : pas
 * de detection de plateforme nécessaire, l'appel est un no-op propre
 * partout où l'API n'existe pas. Enveloppé dans un `try/catch` en plus du
 * guard `typeof` : certains navigateurs lèvent si l'appel arrive hors
 * d'un geste utilisateur direct plutôt que de simplement ignorer.
 */
function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignoré — l'absence de vibration n'est jamais une erreur utilisateur.
  }
}

export const haptics = {
  /** Tap léger — ex. dispo sur le calendrier. */
  light: () => vibrate(30),
  /** Action moyenne — ex. voter pour un jeu. */
  medium: () => vibrate(50),
  /** Action marquante. */
  heavy: () => vibrate(100),
  /** Célébration — level up, badge débloqué. */
  success: () => vibrate([100, 50, 100]),
};
