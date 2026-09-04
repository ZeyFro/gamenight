import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getTotalUserCount } from "@/lib/game-library";
import { getWishlist, enrichWithPrices } from "@/lib/wishlist";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { LibraryTabs } from "@/components/LibraryTabs";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { proposeWishlistGameAction, voteWishlistAction } from "./actions";

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

  const [entries, totalUsers, allGames] = await Promise.all([
    getWishlist(user.id),
    getTotalUserCount(),
    prisma.game.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const prices = await enrichWithPrices(entries);

  const listedGameIds = new Set(entries.map((e) => e.gameId));
  const proposableGames = allGames.filter((g) => !listedGameIds.has(g.id));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🛒 À acheter</h1>

      <LibraryTabs active="wishlist" />

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      {proposableGames.length > 0 && (
        <Card>
          <form action={proposeWishlistGameAction} className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Proposer un jeu</p>
            <select
              name="gameId"
              required
              defaultValue=""
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
            >
              <option value="" disabled>
                Choisir un jeu…
              </option>
              {proposableGames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="reason"
              maxLength={200}
              placeholder="Pourquoi ce jeu ? (optionnel)"
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <Button type="submit" variant="primary" fullWidthOnMobile>
              Proposer
            </Button>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted">Aucun jeu proposé pour l&apos;instant.</p>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {entries.map((e) => {
            const majority = e.interestedCount > totalUsers / 2;
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
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-foreground">{e.gameName}</p>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          majority
                            ? "bg-accent/15 text-accent"
                            : "bg-surface-hover text-muted"
                        }`}
                      >
                        {e.interestedCount}/{totalUsers} intéressés
                      </span>
                    </div>
                    <p className="text-xs text-muted">Proposé par {e.proposedByName}</p>
                    {e.reason && <p className="text-sm text-foreground">{e.reason}</p>}

                    {e.purchasedByName ? (
                      <p className="mt-1 text-sm font-medium text-accent">
                        ✅ Acheté par {e.purchasedByName}
                      </p>
                    ) : (
                      <>
                        <div className="mt-1 flex gap-2">
                          <form action={voteWishlistAction}>
                            <input type="hidden" name="wishlistId" value={e.id} />
                            <input type="hidden" name="interested" value="true" />
                            <Button
                              type="submit"
                              variant={e.myVote === true ? "primary" : "secondary"}
                              size="sm"
                            >
                              Intéressé 👍
                            </Button>
                          </form>
                          <form action={voteWishlistAction}>
                            <input type="hidden" name="wishlistId" value={e.id} />
                            <input type="hidden" name="interested" value="false" />
                            <Button
                              type="submit"
                              variant={e.myVote === false ? "primary" : "secondary"}
                              size="sm"
                            >
                              Pas pour moi 👎
                            </Button>
                          </form>
                        </div>
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
