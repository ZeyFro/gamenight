import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getPlayerClassifiedCommunityId, listPlayerClassifieds } from "@/lib/player-classifieds";
import { wallClockNow } from "@/lib/wallclock";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { createPlayerClassifiedAction, deletePlayerClassifiedAction } from "./actions";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Chercher un joueur");

const ERRORS: Record<string, string> = {
  unavailable: "Les annonces ne sont pas disponibles dans ta communauté.",
  invalid: "Choisis un jeu et écris un message de 1 à 240 caractères.",
  forbidden: "Tu ne peux supprimer que tes annonces, sauf si tu es admin.",
  rate_limited: "Trop de demandes, réessaie dans une minute.",
};

export default async function PlayerClassifiedsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-xl font-semibold text-foreground">🔎 Chercher un joueur</h1>
        <Card className="text-sm text-muted">Les annonces ne sont pas disponibles dans ta communauté.</Card>
        <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Jouer maintenant →</Link>
        <Link href="/equipes" className="text-sm font-medium text-accent">Créer une équipe durable →</Link>
      </main>
    );
  }

  const [{ error }, games, listings] = await Promise.all([
    searchParams,
    prisma.game.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listPlayerClassifieds(user.id, communityId, wallClockNow()),
  ]);
  const admin = isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🔎 Chercher un joueur</h1>
          <p className="mt-1 text-sm text-muted">Annonces visibles par les membres actifs de ta communauté. Elles expirent après 24 h.</p>
        </div>
        <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Jouer maintenant →</Link>
      </div>

      {error && ERRORS[error] && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{ERRORS[error]}</p>}

      <Card>
        <form action={createPlayerClassifiedAction} className="flex flex-col gap-3">
          <label htmlFor="classified-game" className="text-sm font-medium text-foreground">Jeu</label>
          <select id="classified-game" name="gameId" required className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground">
            <option value="">Choisir un jeu</option>
            {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
          </select>
          <label htmlFor="classified-message" className="text-sm font-medium text-foreground">Ton annonce</label>
          <input id="classified-message" name="message" required maxLength={240} placeholder="Il nous manque un joueur pour ce soir…" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
          <Button type="submit" variant="primary">Publier pendant 24 h</Button>
        </form>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="classified-list-title">
        <h2 id="classified-list-title" className="text-sm font-medium text-foreground">Annonces récentes ({listings.length})</h2>
        {listings.length === 0 ? <EmptyState icon="🎮" title="Aucune annonce en cours." /> : (
          <ul className="flex flex-col gap-2">
            {listings.map((listing) => (
              <li key={listing.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{listing.game.name}</p>
                      <p className="text-xs text-muted">Par {listing.createdBy.discordName}</p>
                    </div>
                    {(listing.createdBy.id === user.id || admin) && (
                      <form action={deletePlayerClassifiedAction}>
                        <input type="hidden" name="id" value={listing.id} />
                        <button type="submit" className="text-xs text-destructive underline">Supprimer</button>
                      </form>
                    )}
                  </div>
                  <p className="text-sm text-foreground">{listing.message}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
