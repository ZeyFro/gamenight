import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getInstantSessionView, toInstantSessionViewDTO } from "@/lib/instant-sessions";
import { InstantSessionDetail } from "@/components/jouer-maintenant/InstantSessionDetail";
import { pageMetadata } from "@/lib/page-title";
import { signIn } from "@/auth";
import { LoginLanding } from "@/components/app/LoginLanding";
import { Button } from "@/components/ui/Button";

export const metadata = pageMetadata("Jouer maintenant");

/**
 * V2 — "Jouer maintenant" : page détail d'une session instantanée.
 * `getInstantSessionView` règle expiration/récompenses AU CHARGEMENT
 * (comme à chaque poll ultérieur côté client, voir `InstantSessionDetail`)
 * — jamais un état périmé affiché au premier rendu.
 */
export default async function InstantSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return <LoginLanding><form action={async () => {
    "use server";
    // Chemin interne encodé : aucune URL de redirection fournie par le client.
    await signIn("discord", { redirectTo: `/jouer-maintenant/${encodeURIComponent(id)}` });
  }}><Button type="submit" variant="primary">Se connecter pour rejoindre la partie</Button></form></LoginLanding>;
  const view = await getInstantSessionView(id, user.id);
  if (!view) redirect("/jouer-maintenant");

  // Biblio complète pour le contrôle "changer de jeu" (créateur
  // uniquement, mais chargée pour tout le monde ici — coût négligeable,
  // le composant lui-même n'affiche le contrôle qu'au créateur).
  const games = await prisma.game.findMany({
    select: { id: true, name: true, igdbId: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <InstantSessionDetail
        instantSessionId={id}
        currentUserId={user.id}
        initialView={toInstantSessionViewDTO(view)}
        localGames={games}
      />
    </div>
  );
}
