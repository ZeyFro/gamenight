import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      discordId: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string;
    /** Jeton d'accès Discord (scope `identify`) — sert au rafraîchissement périodique de l'avatar/pseudo. */
    discordAccessToken?: string;
    /** Timestamp (ms) du dernier rafraîchissement avatar/pseudo depuis l'API Discord — throttle le polling. */
    discordSyncedAt?: number;
  }
}
