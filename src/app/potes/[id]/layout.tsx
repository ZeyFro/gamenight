import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { canViewPote } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { getMemberStatsForViewer, projectUserProgress } from "@/lib/member-stats";
import { Badge } from "@/components/ui/Badge";
import { PoteTabs } from "@/components/PoteTabs";
import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import { levelForXp, rankForLevel } from "@/lib/xp";

/**
 * En-tête + onglets partagés par les 5 sous-routes de `/potes/[id]`
 * (Dispos/Bibliothèque/Tierlist/Badges/Superlatifs — FIX UX préliminaire
 * PR 7/9, 5e onglet ajouté en PR 8/9) — sur l'ancienne page unique, tout
 * était empilé verticalement (scroll interminable pour voir la tierlist
 * en bas de page).
 *
 * Avatar à anneau coloré + pastille de niveau (`RankAvatar`, PR 8/9) —
 * même composant que `/profil`, pas de bannière ici (pas demandé pour la
 * fiche d'un pote, seulement pour son propre profil).
 */
export default async function PoteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  // Fix UX (PR 9/9) : ce lien mène forcément d'abord à la connexion (app
  // privée) — `?redirect=/potes/[id]` permet à `/` d'annoncer "Tu vas voir
  // le profil de X" et de renvoyer vers cette page une fois connecté,
  // plutôt que de lâcher l'invité sur l'accueil générique sans contexte.
  if (!user) redirect(`/?redirect=/potes/${id}`);
  // Sa propre carte n'apparaît pas dans /potes, mais on couvre quand même
  // le cas (lien direct, avatar cliqué depuis la biblio de groupe) plutôt
  // que d'afficher une biblio "en lecture seule" de soi-même.
  if (id === user.id) redirect("/bibliotheque");

  // Multi-communautés (PR4) : fiche d'un membre d'une autre communauté =
  // indistinct d'un pote inexistant (contrôle aussi répété dans chaque page).
  if (!(await canViewPote(user.id, id))) notFound();
  const rawPote = await prisma.user.findUnique({ where: { id } });
  if (!rawPote) notFound();
  const pote = projectUserProgress(rawPote, await getMemberStatsForViewer(id, user.id));

  const level = levelForXp(pote.xpTotal);
  const rank = rankForLevel(level);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href="/potes"
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Potes
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <RankAvatar src={pote.discordAvatar} alt={pote.discordName} level={level} rank={rank} size={48} />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
              {pote.discordName}
              <ColorDot color={pote.color} title={`Couleur de ${pote.discordName}`} />
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rank-badge-shimmer rounded-full px-2.5 py-1 text-xs font-medium ${rank.colorClass}`}
              >
                {rank.name}
              </span>
              <Badge tone={pote.steamId64 ? "accent" : "neutral"}>
                {pote.steamId64 ? "Steam lié" : "Steam non lié"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <PoteTabs poteId={id} />

      {children}
    </div>
  );
}
