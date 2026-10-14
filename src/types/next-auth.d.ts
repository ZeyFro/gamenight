import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      discordId: string;
      /** Timestamp (ms) de création de CE token JWT (posé une seule fois, à la connexion) — sert à détecter les sessions à invalider après un `forceReloginAt` (voir `getCurrentUser`). `undefined` pour toute session créée avant ce champ (traitée comme "à reconnecter" si un `forceReloginAt` existe). */
      sessionCreatedAt?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string;
    /** Timestamp (ms) du dernier rafraîchissement avatar/pseudo depuis l'API Discord — throttle le polling. */
    discordSyncedAt?: number;
    /** Timestamp (ms) de création de ce token (posé une seule fois, à la connexion OAuth fraîche) — voir `Session.user.sessionCreatedAt`. */
    sessionCreatedAt?: number;
  }
}
