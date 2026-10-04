import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { SuperlativesWonGrid } from "@/components/SuperlativesWonGrid";
import { FadeInView } from "@/components/ui/FadeInView";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mes récompenses");

/** Onglet "Superlatifs gagnés" — voir `../layout.tsx` pour l'en-tête. */
export default async function ProfilSuperlatifsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  // Chantier nettoyage réel du stockage (V2, suite) — `gameName`/
  // `sessionDate` DÉNORMALISÉS sur `SuperlativeAward` lui-même (survit à
  // la purge de la soirée, `session` devient `null` — jamais rejoint pour
  // ces deux champs).
  const awards = await prisma.superlativeAward.findMany({
    where: { winnerUserId: user.id },
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <FadeInView>
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
    </FadeInView>
  );
}
