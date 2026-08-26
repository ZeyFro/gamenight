import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { SuperlativesWonGrid } from "@/components/SuperlativesWonGrid";

/** Onglet "Superlatifs" — voir `../layout.tsx` pour l'en-tête. Lecture seule. */
export default async function PoteSuperlatifsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const awards = await prisma.superlativeAward.findMany({
    where: { winnerUserId: id },
    include: { category: true, session: { include: { decidedGame: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <SuperlativesWonGrid
      awards={awards.map((a) => ({
        id: a.id,
        categoryIcon: a.category.icon,
        categoryName: a.category.name,
        gameName: a.session.decidedGame?.name ?? "?",
        sessionDate: a.session.date,
        voteCount: a.voteCount,
      }))}
      emptyMessage="Aucune récompense gagnée pour l'instant."
    />
  );
}
