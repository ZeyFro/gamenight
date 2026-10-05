import { notFound, redirect } from "next/navigation";
import { canViewPote } from "@/lib/community-isolation";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { SuperlativesWonGrid } from "@/components/SuperlativesWonGrid";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Récompenses d'un pote");

/** Onglet "Superlatifs" — voir `../layout.tsx` pour l'en-tête. Lecture seule. */
export default async function PoteSuperlatifsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const scopedDb = await getActiveScopedPrisma(user.id);

  const { id } = await params;
  // Multi-communautés (PR4) : contrôle répété dans chaque page (voir tierlist).
  if (!(await canViewPote(user.id, id))) notFound();

  // Chantier nettoyage réel du stockage (V2, suite) — `gameName`/
  // `sessionDate` dénormalisés, survivent à la purge de la soirée.
  const awards = await scopedDb.superlativeAward.findMany({
    where: { winnerUserId: id },
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <SuperlativesWonGrid
      awards={awards.map((a) => ({
        id: a.id,
        categoryIcon: a.category.icon,
        categoryName: a.category.name,
        gameName: a.gameName ?? "?",
        sessionDate: a.sessionDate ?? a.createdAt,
        voteCount: a.voteCount,
      }))}
      emptyMessage="Aucune récompense gagnée pour l'instant."
    />
  );
}
