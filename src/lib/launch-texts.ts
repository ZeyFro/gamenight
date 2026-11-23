/**
 * Textes et navigation d'ouverture (audit du 20/11/2026 : V3-02, V3-12, V3-15, V3-18).
 *
 * Deux interrupteurs OFF par défaut, actifs uniquement si la valeur vaut exactement
 * `true` (même modèle que `skip-link.ts`), lus côté serveur :
 * - `LAUNCH_TEXTS_ENABLED` : phrase d'accès réservé et lien d'invitation sur la page de
 *   connexion, phrase sur les étages Tower, blocs techniques de `/sessions/[id]` masqués
 *   quand la fonction est éteinte ou non configurée ;
 * - `NAV_TOWER_ENABLED` : lien « The Tower » dans la barre latérale et le menu mobile.
 * Éteints, le rendu reste identique à celui d'avant.
 */
export function isLaunchTextsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LAUNCH_TEXTS_ENABLED === "true";
}

export function isNavTowerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NAV_TOWER_ENABLED === "true";
}

/** Connexion fermée (S0) : dit d'emblée pourquoi un visiteur extérieur sera refusé. */
export const LOGIN_MEMBERS_ONLY_NOTICE = "L’accès est réservé aux membres du serveur Discord The Tower.";

/**
 * Phrase décidée le 18/11/2026, reprise mot pour mot de docs/SOIREE_ACTIVATION.md (§ 4 bis) :
 * ne pas la reformuler sans nouvelle décision.
 */
export const TOWER_FLOORS_RESET_NOTICE =
  "Ton niveau, ton niveau d’XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro et se gagnent par les défis, et ton grade Tower (Régulars, Irregular, Ranker, High Ranker) repart avec eux.";

/**
 * V3-18 — `/sessions/[id]` : présence vocale. Avec `LAUNCH_TEXTS_ENABLED`, le bloc n'est rendu
 * que si la collecte est active (éteinte, il n'offre aucune action : `readSessionVoicePresence`
 * renvoie alors `canConsent`/`canWithdraw` à faux et aucune durée). Éteint : comportement d'avant.
 */
export function shouldShowVoicePresence(presence: { enabled: boolean } | null, launchTexts: boolean): boolean {
  if (!presence) return false;
  return !launchTexts || presence.enabled;
}

/**
 * V3-18 — `/sessions/[id]` : galerie. Avec `LAUNCH_TEXTS_ENABLED`, une galerie dont le stockage
 * n'est pas configuré n'est montrée qu'à qui peut gérer le contenu (créateur, admins invités) ;
 * un membre ordinaire n'y voit aucune image ni action. Éteint : comportement d'avant.
 */
export function shouldShowSessionGallery(input: { galleryEnabled: boolean; storageReady: boolean; canManage: boolean; launchTexts: boolean }): boolean {
  if (!input.galleryEnabled) return false;
  return !input.launchTexts || input.storageReady || input.canManage;
}

/** Remplace le message technique sur le stockage (« Blob privé ») par un texte clair. */
export const GALLERY_UNAVAILABLE_NOTICE = "Les photos ne sont pas encore disponibles.";
