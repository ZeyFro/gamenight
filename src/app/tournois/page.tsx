import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { requireCommunityChosen } from "@/lib/community-picker";
import { prisma } from "@/lib/prisma";
import { communityIdFilter, resolveActiveCommunityScope } from "@/lib/community-isolation";
import { isTournamentVisibleInHistory } from "@/lib/tournaments";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Stagger, StaggerItem } from "@/components/motion";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Tournois");

const TABS = [
  { key: "en-cours", label: "En cours" },
  { key: "a-venir", label: "À venir" },
  { key: "termines", label: "Terminés" },
  { key: "annules", label: "Annulés" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Sprint 5 (FEATURE 1, Tournois Bracket) — liste des tournois, 3 onglets :
 * "En cours" (`IN_PROGRESS`), "À venir" (`REGISTRATION`, inscriptions
 * ouvertes) et "Terminés" (`DONE`, champion affiché).
 */
export default async function TournoisPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  await requireCommunityChosen(user.id, "/tournois");

  const { tab } = await searchParams;
  const activeTab: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : "en-cours";

  const statusForTab: Record<TabKey, "IN_PROGRESS" | "REGISTRATION" | "DONE" | "CANCELLED"> = {
    "en-cours": "IN_PROGRESS",
    "a-venir": "REGISTRATION",
    termines: "DONE",
    annules: "CANCELLED",
  };

  const tournamentsAll = await prisma.tournament.findMany({
    // Multi-communautés (PR4) : uniquement les tournois des communautés de
    // l'utilisateur (aucun filtre si l'isolation est éteinte).
    where: { status: statusForTab[activeTab], ...communityIdFilter(await resolveActiveCommunityScope(user.id)) },
    orderBy: { createdAt: "desc" },
    include: {
      game: { select: { name: true, coverUrl: true } },
      champion: { select: { discordName: true, discordAvatar: true } },
      participants: { select: { userId: true } },
      matches: { select: { completedAt: true } },
    },
  });

  // Cycle de vie de l'historique (V2, bug remonté en test réel) — un
  // tournoi "Terminé"/"Annulé" depuis plus de 7 jours sort de CETTE
  // LISTE (jamais de la base, jamais du lien direct par id — voir
  // `isTournamentVisibleInHistory`, tournaments.ts). N'affecte jamais
  // "En cours"/"À venir" (toujours vrai pour ces statuts).
  const tournaments = tournamentsAll.filter((t) => isTournamentVisibleInHistory(t));

  return (
    <PullToRefresh>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🏆 Tournois</h1>
          <ButtonLink href="/tournois/creer" variant="primary" size="sm">
            + Créer
          </ButtonLink>
        </div>

        <SegmentedControl
          groupId="tournois-tabs"
          activeKey={activeTab}
          options={TABS.map((t) => ({ key: t.key, label: t.label, href: `/tournois?tab=${t.key}` }))}
        />

        {tournaments.length === 0 ? (
          <EmptyState
            icon="🏆"
            title="Lance le premier tournoi entre potes"
            action={
              <ButtonLink href="/tournois/creer" variant="primary" size="sm">
                + Créer un tournoi
              </ButtonLink>
            }
          />
        ) : (
          <Stagger className="flex flex-col gap-3">
            {tournaments.map((t) => (
              <StaggerItem key={t.id}>
                <Link href={`/tournois/${t.id}`}>
                  <Card className="card-glow flex items-center gap-3 transition-all duration-200">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{t.name}</p>
                      <p className="truncate text-sm text-muted">{t.game.name}</p>
                      {t.status === "DONE" && t.champion ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-accent">
                          <Avatar src={t.champion.discordAvatar} alt={t.champion.discordName} size={18} />
                          Champion : {t.champion.discordName}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted">
                          {t.participants.length}/{t.maxPlayers} joueur
                          {t.maxPlayers === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-lg" aria-hidden>
                      🏆
                    </span>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </PullToRefresh>
  );
}
