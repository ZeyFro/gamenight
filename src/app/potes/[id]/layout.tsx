import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { PoteTabs } from "@/components/PoteTabs";

/**
 * En-tête + onglets partagés par les 4 sous-routes de `/potes/[id]`
 * (Dispos/Bibliothèque/Tierlist/Badges, FIX UX préliminaire PR 7/9) — sur
 * l'ancienne page unique, tout était empilé verticalement (scroll
 * interminable pour voir la tierlist en bas de page).
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
          <Avatar src={pote.discordAvatar} alt={pote.discordName} size={48} />
          <div>
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
              {pote.discordName}
            </h1>
            <Badge tone={pote.steamId64 ? "accent" : "neutral"}>
              {pote.steamId64 ? "Steam lié" : "Steam non lié"}
            </Badge>
          </div>
        </div>
      </div>

      <PoteTabs poteId={id} />

      {children}
    </div>
  );
}
