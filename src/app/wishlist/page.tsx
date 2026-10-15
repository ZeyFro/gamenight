import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getTotalUserCount } from "@/lib/game-library";
import { getWishlist, enrichWithPrices } from "@/lib/wishlist";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { LibraryTabs } from "@/components/LibraryTabs";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/motion";
import { WishlistProposeForm } from "@/components/wishlist/WishlistProposeForm";
import { WishlistVoteButtons } from "@/components/wishlist/WishlistVoteButtons";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Wishlist");

const WISHLIST_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

/** Sprint 5 (FEATURE 3, Wishlist V17) — jeux que le groupe aimerait acheter, proposés puis votés. */
export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? (WISHLIST_ERROR_MESSAGES[error] ?? null) : null;

  const [entries, totalUsers] = await Promise.all([getWishlist(user.id), getTotalUserCount(user.id)]);
  const prices = await enrichWithPrices(entries);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🛒 À acheter</h1>

      <LibraryTabs active="wishlist" />

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      <Card>
        <WishlistProposeForm />
      </Card>

      {entries.length === 0 ? (
        <EmptyState icon="🛒" title="Propose un jeu que le groupe devrait acheter" />
      ) : (
        <Stagger className="flex flex-col gap-3">
          {entries.map((e) => {
            return (
              <StaggerItem key={e.id}>
                <Card className="flex gap-3">
                  {e.coverUrl && (
                    <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                      <Image
                        src={e.coverUrl}
                        alt=""
                        width={64}
                        height={96}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="truncate font-medium text-foreground">{e.gameName}</p>
                    <p className="text-xs text-muted">Proposé par {e.proposedByName}</p>
                    {e.reason && <p className="text-sm text-foreground">{e.reason}</p>}

                    {e.purchasedByName ? (
                      <p className="mt-1 text-sm font-medium text-accent">
                        ✅ Acheté par {e.purchasedByName}
                      </p>
                    ) : (
                      <>
                        <WishlistVoteButtons
                          wishlistId={e.id}
                          totalUsers={totalUsers}
                          initialMyVote={e.myVote}
                          initialInterestedCount={e.interestedCount}
                        />
                        {prices.get(e.id) && e.steamAppId && (
                          <a
                            href={`https://store.steampowered.com/app/${e.steamAppId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 text-xs text-accent hover:underline"
                          >
                            {prices.get(e.id)} sur Steam →
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
