import type { User } from "@prisma/client";

/**
 * Logique pure de décision admin (PR "Accès & secrets"), séparée de
 * `src/lib/admin.ts` : ce fichier n'importe ni `getCurrentUser` ni `@/auth`
 * (qui charge next-auth) pour rester testable sans faire planter la
 * résolution de modules de Vitest sur `next/server` — même raison que la
 * séparation `calendar-dates.ts`/`calendar.ts` dans ce projet.
 */

/** CSV → Set, testable isolément de `process.env`. */
export function parseAdminDiscordIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

/**
 * Filet anti-verrouillage : un discordId dans `adminDiscordIds` est
 * TOUJOURS admin, même si `role` dit `USER` en base.
 */
export function isAdminUser(
  user: Pick<User, "discordId" | "role">,
  adminDiscordIds: Set<string>
): boolean {
  return adminDiscordIds.has(user.discordId) || user.role === "ADMIN";
}
