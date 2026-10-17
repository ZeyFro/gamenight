import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getTotalUserCount } from "@/lib/game-library";
import { getWishlist, enrichWithPrices } from "@/lib/wishlist";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { LibraryTabs } from "@/components/LibraryTabs";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { WishlistProposeForm } from "@/components/wishlist/WishlistProposeForm";
import { WishlistVoteButtons } from "@/components/wishlist/WishlistVoteButtons";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { saveWishlistPurchasePlanAction } from "@/app/wishlist/actions";

export const metadata = pageMetadata("Wishlist");

const WISHLIST_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};
const PURCHASE_PLAN_MESSAGES: Record<string, string> = {
  saved: "Le plan indicatif a été enregistré.",
  invalid: "Choisis une date valide, aujourd'hui ou après, et une note de 300 caractères maximum.",
  unavailable: "Cette entrée ne peut plus recevoir de plan.",
  forbidden: "Seul le proposant du jeu peut modifier son plan.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

/** Sprint 5 (FEATURE 3, Wishlist V17) — jeux que le groupe aimerait acheter, proposés puis votés. */
export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; plan?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error, plan } = await searchParams;
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
      {plan && PURCHASE_PLAN_MESSAGES[plan] && (
        <p role="status" className={`rounded-lg p-3 text-sm ${plan === "saved" ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"}`}>
          {PURCHASE_PLAN_MESSAGES[plan]}
        </p>
      )}

      <Card>
        <WishlistProposeForm />
      </Card>

      <p className="text-sm text-muted">
        <a href="https://store.epicgames.com/free-games?lang=fr" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Voir les jeux gratuits de la semaine sur Epic Games Store →</a>
        {" · "}<a href="/jeux-gratuits" className="text-accent hover:underline">Sélection Steam/Epic du groupe →</a>
      </p>

      {entries.length === 0 ? (
        <EmptyState icon="🛒" title="Propose un jeu que le groupe devrait acheter" />
      ) : (
        <Stagger className="flex flex-col gap-3">
          {entries.map((e) => {
            const offer = prices.get(e.id);
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
                        {e.purchasePlansEnabled && (
                          <section className="mt-3 rounded-lg border border-border p-3" aria-label={`Plan indicatif pour ${e.gameName}`}>
                            {e.purchasePlanTargetDate ? (
                              <div className="mb-2 text-sm text-foreground">
                                <p className="font-medium">📅 Plan indicatif · {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(e.purchasePlanTargetDate)}</p>
                                {e.purchasePlanNote && <p className="mt-1 whitespace-pre-wrap text-muted">{e.purchasePlanNote}</p>}
                              </div>
                            ) : (
                              <p className="mb-2 text-sm font-medium text-foreground">Aucun plan proposé pour le moment.</p>
                            )}
                            {e.canManagePurchasePlan && (
                              <form action={saveWishlistPurchasePlanAction} className="flex flex-col gap-2">
                                <input type="hidden" name="wishlistId" value={e.id} />
                                <label htmlFor={`${e.id}-plan-date`} className="text-xs text-muted">Date visée (indicative)</label>
                                <input
                                  id={`${e.id}-plan-date`}
                                  type="date"
                                  name="targetDate"
                                  required
                                  min={new Date().toISOString().slice(0, 10)}
                                  defaultValue={e.purchasePlanTargetDate?.toISOString().slice(0, 10) ?? ""}
                                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                                />
                                <label htmlFor={`${e.id}-plan-note`} className="text-xs text-muted">Organisation (facultatif, 300 caractères max.)</label>
                                <textarea
                                  id={`${e.id}-plan-note`}
                                  name="note"
                                  maxLength={300}
                                  rows={2}
                                  defaultValue={e.purchasePlanNote ?? ""}
                                  className="rounded-lg border border-border bg-background p-3 text-sm text-foreground"
                                />
                                <p className="text-xs text-muted">Le vote « intéressé » exprime une préférence, pas un engagement. Aucun paiement ni achat automatique.</p>
                                <Button type="submit" size="sm">{e.purchasePlanTargetDate ? "Mettre à jour le plan" : "Proposer un plan"}</Button>
                              </form>
                            )}
                          </section>
                        )}
                        {offer && e.steamAppId && (
                          <a
                            href={`https://store.steampowered.com/app/${e.steamAppId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 text-xs text-accent hover:underline"
                          >
                            {offer.discountPercent ? <><strong>-{offer.discountPercent}%</strong>{offer.initialPriceFormatted && <> <del>{offer.initialPriceFormatted}</del></>} {offer.priceFormatted} sur Steam →</> : offer.isFree ? "Gratuit sur Steam →" : offer.priceFormatted ? `${offer.priceFormatted} sur Steam →` : "Voir sur Steam →"}
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
