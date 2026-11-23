/**
 * Notifications push sur iPhone (audit du 23/11/2026, constats 2.4 à 2.6) : Apple n'offre le Web Push qu'à partir d'iOS 16.4 et
 * SEULEMENT pour un site ajouté à l'écran d'accueil ; dans Safari, `PushManager` est absent. Sans détection, le clic échouait avec un
 * message générique. Fonction PURE (aucun accès à `window`) : le composant lui passe ce qu'il lit dans le navigateur.
 */
export type PushSupport = "supported" | "ios_needs_install" | "unsupported";

export interface PushEnvironment {
  userAgent: string;
  /** `navigator.platform` : un iPad récent se présente comme « MacIntel » avec un écran tactile. */
  platform?: string;
  maxTouchPoints?: number;
  /** `navigator.standalone` (Safari iOS) ou `matchMedia("(display-mode: standalone)")` : application lancée depuis l'écran d'accueil. */
  installed: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function isIosDevice(env: Pick<PushEnvironment, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iPhone|iPad|iPod/i.test(env.userAgent)) return true;
  return env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1;
}

export function detectPushSupport(env: PushEnvironment): PushSupport {
  if (isIosDevice(env) && !env.installed) return "ios_needs_install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return "supported";
}

/** Étapes affichées sur iPhone et iPad hors mode installé. */
export const IOS_INSTALL_STEPS = [
  "Ouvre GameNight dans Safari.",
  "Touche Partager (le carré avec la flèche).",
  "Choisis « Sur l’écran d’accueil », puis « Ajouter ».",
  "Ouvre GameNight depuis la nouvelle icône, va dans Paramètres et touche « Activer sur cet appareil ».",
] as const;

export const IOS_VERSION_NOTE = "Il faut iOS 16.4 ou plus récent.";
export const PUSH_UNSUPPORTED_MESSAGE = "Cet appareil ou ce navigateur ne prend pas en charge les notifications.";
export const PUSH_DENIED_MESSAGE = "Les notifications sont bloquées pour GameNight. Autorise-les dans les réglages de ton appareil (sur iPhone : Réglages, Notifications, GameNight), puis réessaie.";
