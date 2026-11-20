/**
 * Messages de la page de connexion (`/?error=<code Auth.js>`).
 *
 * `AccessDenied` : `signIn` (src/auth.ts) renvoie `false` quand le compte n'a aucune
 * appartenance ACTIVE à une communauté ACTIVE, mais aussi quand Discord ou la base ne
 * peuvent pas confirmer la présence sur le serveur. Le message le dit clairement et
 * donne une action : rejoindre le serveur Discord The Tower, puis se reconnecter.
 *
 * Le lien d'invitation vient de `DISCORD_INVITE_URL` (non secret, facultatif) : rien
 * n'est inventé dans le code, sans la variable le message n'affiche pas de lien.
 */

// Auth.js masque volontairement la vraie cause derrière `error=Configuration`
// (voir src/app/page.tsx pour le contexte du navigateur intégré à Discord).
const MESSAGES: Record<string, string> = {
  Configuration:
    "La connexion a échoué (erreur serveur pendant l'aller-retour avec Discord). Si tu as cliqué sur le lien depuis l'appli Discord ou une autre appli, réessaie en ouvrant ce site dans ton navigateur (Safari, Chrome…) plutôt que dans leur fenêtre intégrée.",
  AccessDenied:
    "Connexion refusée : GameNight est réservé aux membres du serveur Discord The Tower. Rejoins le serveur, puis reconnecte-toi. Si tu en es déjà membre, réessaie dans un instant : Discord n'a peut-être pas pu confirmer ta présence.",
  OAuthCallbackError: "La connexion Discord a échoué (lien de connexion expiré ou déjà utilisé). Réessaie.",
  Verification: "Le lien de connexion n'est plus valide. Réessaie.",
};

export const DEFAULT_AUTH_ERROR_MESSAGE = "La connexion a échoué. Réessaie dans un instant.";

/** Seuls les liens d'invitation Discord officiels en https sont acceptés (jamais un lien arbitraire). */
const INVITE_PATTERN = /^https:\/\/(?:discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,64}$/;

export function discordInviteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.DISCORD_INVITE_URL?.trim();
  return value && INVITE_PATTERN.test(value) ? value : null;
}

export interface AuthErrorView {
  message: string;
  /** Lien « Rejoindre le serveur », seulement pour `AccessDenied` et si `DISCORD_INVITE_URL` est valide. */
  inviteUrl: string | null;
}

export function authErrorView(code: string, env: Record<string, string | undefined> = process.env): AuthErrorView {
  return {
    message: MESSAGES[code] ?? DEFAULT_AUTH_ERROR_MESSAGE,
    inviteUrl: code === "AccessDenied" ? discordInviteUrl(env) : null,
  };
}
