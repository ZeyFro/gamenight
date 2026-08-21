import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.discordId) return null;
  return prisma.user.findUnique({ where: { discordId: session.user.discordId } });
}
