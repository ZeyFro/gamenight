/**
 * Cycle de vie de l'historique (V2, bug remonté en test réel — des
 * soirées d'août/début septembre encombraient encore l'historique
 * visible). Fenêtre PARTAGÉE entre soirées (`sessions.ts`) et tournois
 * (`tournaments.ts`) : après ce délai depuis leur fin RÉELLE (effective
 * ou annulation, jamais leur ancienneté de création), un événement
 * terminé/annulé disparaît de la LISTE affichée — jamais de la base
 * (statistiques, XP, récompenses et résultats restent intacts, voir les
 * commentaires des deux appelants), jamais du contrôle d'accès (un lien
 * direct vers un id précis continue de fonctionner pour qui y a/avait
 * droit — cette fenêtre ne gouverne QUE la liste, jamais
 * `accessibleSessionWhere`/`canAccessSession` ni leur équivalent tournoi).
 *
 * Ne s'applique JAMAIS à un événement encore ACTIF, quel que soit son
 * âge — voir les deux fonctions `is*VisibleInHistory`, qui court-circuitent
 * systématiquement sur le statut avant de consulter cette fenêtre.
 */
export const HISTORY_VISIBILITY_WINDOW_DAYS = 7;

/**
 * Production du 24/11/2026 : l'onglet « Historique » de /sessions affichait « Aucune soirée dans l'historique » alors que 28 soirées
 * terminées existaient, parce que la fenêtre de 7 jours ci-dessus masquait TOUTE soirée terminée depuis plus d'une semaine. Cette
 * fenêtre reste celle de la RÉTENTION (purge) et des soirées annulées ; une soirée JOUÉE, elle, est l'historique : elle reste dans la
 * liste 365 jours (jamais plus long : la liste est lue en entier à chaque affichage). Le contrôle d'accès ne change pas.
 */
export const DONE_SESSION_HISTORY_WINDOW_DAYS = 365;

export function isWithinDoneSessionHistoryWindow(referenceDate: Date, now: Date): boolean {
  return now.getTime() - referenceDate.getTime() < DONE_SESSION_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Vrai si `referenceDate` (le point de départ RÉEL — fin effective ou
 * annulation, jamais une date inventée) est encore dans la fenêtre de
 * visibilité, comptée depuis `now`. Une soirée/un tournoi du 21 septembre
 * reste visible jusqu'au 28 septembre inclus — jamais masqué le 22 sous
 * prétexte des "sept jours" (la fenêtre se compte en millisecondes
 * pleines depuis `referenceDate`, jamais tronquée au jour calendaire).
 */
export function isWithinHistoryWindow(referenceDate: Date, now: Date): boolean {
  const windowMs = HISTORY_VISIBILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - referenceDate.getTime() < windowMs;
}
