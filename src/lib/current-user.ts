import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { touchStreak } from "@/lib/xp-actions";

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.discordId) return null;

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
  });
  if (!user) return null;

  // Chantier XP : tient le streak de connexion à jour à chaque page
  // protégée — `touchStreak` throttle lui-même ses écritures (pas de
  // requête supplémentaire tant que < 12h se sont écoulées depuis le
  // dernier passage), donc appelable ici sans coût perf notable.
  const streak = await touchStreak(user);

  return { ...user, ...streak };
}
