import Link from "next/link";
import { redirect } from "next/navigation";
import { CommunityGameQuiz } from "@/components/CommunityGameQuiz";
import { Card } from "@/components/ui/Card";
import { FadeInView } from "@/components/ui/FadeInView";
import { getCommunityQuizGames } from "@/lib/community-content";
import { buildCommunityGameQuizRound } from "@/lib/community-game-quiz";
import { getCurrentUser } from "@/lib/current-user";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Devine le jeu");

export default async function GuessTheGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const games = await getCommunityQuizGames(user.id);
  const round = buildCommunityGameQuizRound(games);

  return (
    <FadeInView className="flex flex-col gap-4">
      <Link href="/profil/lore" className="min-h-11 self-start text-sm text-accent hover:underline">← Retour au Lore du groupe</Link>
      <header>
        <h2 className="text-lg font-semibold text-foreground">🕵️ Devine le jeu</h2>
        <p className="mt-1 text-sm text-muted">Un jeu déjà joué par le groupe, trois indices, une tentative. Aucun score n’est enregistré.</p>
      </header>
      {round ? (
        <CommunityGameQuiz round={round} />
      ) : (
        <Card><p className="text-sm text-muted">Pas encore assez de fiches de jeux joués avec des indices disponibles. Revenez après l’enrichissement de quelques fiches IGDB.</p></Card>
      )}
    </FadeInView>
  );
}
