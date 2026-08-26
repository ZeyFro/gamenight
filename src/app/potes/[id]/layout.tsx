import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { PoteTabs } from "@/components/PoteTabs";
import { RankAvatar } from "@/components/RankAvatar";
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
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  // Sa propre carte n'apparaît pas dans /potes, mais on couvre quand même
  // le cas (lien direct, avatar cliqué depuis la biblio de groupe) plutôt
  // que d'afficher une biblio "en lecture seule" de soi-même.
  if (id === user.id) redirect("/bibliotheque");

  const pote = await prisma.user.findUnique({ where: { id } });
  if (!pote) notFound();

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
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
              {pote.discordName}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${rank.colorClass}`}>
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
