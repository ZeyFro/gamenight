import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getFreeGamesCommunityId, listCurrentFreeGameOffers } from "@/lib/free-game-offers";
import { wallClockNow, formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Jeux gratuits");

export default async function FreeGamesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getFreeGamesCommunityId(user.id);
  const offers = communityId
    ? await listCurrentFreeGameOffers(user.id, communityId, wallClockNow())
    : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🎁 Jeux gratuits</h1>
          <p className="mt-1 text-sm text-muted">Sélection française ajoutée manuellement par les admins; vérifie les conditions sur la boutique avant de réclamer.</p>
        </div>
        <Link href="/wishlist" className="text-sm font-medium text-accent">Wishlist →</Link>
      </div>

      {!communityId ? (
        <Card className="text-sm text-muted">Les offres ne sont pas activées pour ta communauté.</Card>
      ) : offers.length === 0 ? (
        <EmptyState icon="🎁" title="Aucune offre gratuite en cours." />
      ) : (
        <ul className="flex flex-col gap-3">
          {offers.map((offer) => (
            <li key={offer.id}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{offer.title}</p>
                  <p className="text-xs text-muted">{offer.store === "STEAM" ? "Steam" : "Epic Games Store"} · gratuit jusqu&apos;au {formatDateTimeFr(offer.endsAt)}</p>
                </div>
                <a href={offer.storeUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm font-medium text-accent underline">Réclamer ↗</a>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
