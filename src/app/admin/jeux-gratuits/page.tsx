import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createFreeGameOfferAction, deleteFreeGameOfferAction } from "./actions";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Administration des jeux gratuits");

const ERRORS: Record<string, string> = {
  invalid: "Vérifie le titre, le lien FR et les dates; la fin doit être future et suivre le début.",
  disabled: "Active d'abord les jeux gratuits pour cette communauté dans l'onglet Communautés.",
  confirmation: "Confirme que le jeu est réellement gratuit pendant la période indiquée.",
  rate_limited: "Trop de demandes, réessaie dans une minute.",
};

export default async function AdminFreeGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ communityId?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const { communityId: requestedId, error } = await searchParams;
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, freeGamesEnabled: true },
    orderBy: { name: "asc" },
  });
  const selected = communities.find((community) => community.id === requestedId) ?? communities[0] ?? null;
  const scopedDb = selected ? await scopedPrismaForCommunityId(selected.id) : null;
  const offers = selected && scopedDb
    ? await scopedDb.freeGameOffer.findMany({
        where: { communityId: selected.id },
        select: { id: true, store: true, title: true, storeUrl: true, startsAt: true, endsAt: true },
        orderBy: [{ startsAt: "desc" }, { endsAt: "desc" }],
      })
    : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Jeux gratuits</h1>
          <p className="mt-1 text-sm text-muted">Curation manuelle avec liens officiels en français. Aucune collecte automatique.</p>
        </div>
        <Link href="/admin?tab=communautes" className="text-sm font-medium text-accent">Communautés →</Link>
      </div>

      {error && ERRORS[error] && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{ERRORS[error]}</p>}
      {communities.length === 0 ? <Card className="text-sm text-muted">Aucune communauté active à configurer.</Card> : (
        <>
          <form method="get" className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-foreground">
              Communauté
              <select name="communityId" defaultValue={selected?.id} className="rounded-lg border border-border bg-background px-3 py-3 text-base">
                {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm">Afficher</Button>
          </form>

          {selected && (selected.freeGamesEnabled ? (
            <Card>
              <form action={createFreeGameOfferAction} className="flex flex-col gap-3">
                <input type="hidden" name="communityId" value={selected.id} />
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Jeu
                  <input name="title" required maxLength={120} className="rounded-lg border border-border bg-background px-3 py-3 text-base" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Boutique
                  <select name="store" className="rounded-lg border border-border bg-background px-3 py-3 text-base">
                    <option value="STEAM">Steam</option><option value="EPIC">Epic Games Store</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Lien français officiel
                  <input name="storeUrl" type="url" required placeholder="https://store.steampowered.com/app/…/?l=french" className="rounded-lg border border-border bg-background px-3 py-3 text-base" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Début de l&apos;offre (heure locale du groupe)
                  <input name="startsAt" type="datetime-local" required className="rounded-lg border border-border bg-background px-3 py-3 text-base" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Fin de l&apos;offre (heure locale du groupe)
                  <input name="endsAt" type="datetime-local" required className="rounded-lg border border-border bg-background px-3 py-3 text-base" />
                </label>
                <label className="flex items-start gap-2 text-sm text-muted">
                  <input type="checkbox" name="freeConfirmed" required className="mt-1" />
                  J&apos;ai vérifié sur la boutique que le jeu est entièrement gratuit durant ces dates (pas seulement gratuit à jouer ou remisé).
                </label>
                <Button type="submit" variant="primary">Publier dans l&apos;app</Button>
              </form>
            </Card>
          ) : (
            <Card className="text-sm text-muted">La fonction est désactivée. Active-la dans l&apos;onglet Communautés avant de publier.</Card>
          ))}

          <section className="flex flex-col gap-3" aria-labelledby="offers-title">
            <h2 id="offers-title" className="text-sm font-medium text-foreground">Offres sélectionnées ({offers.length})</h2>
            {offers.map((offer) => (
              <Card key={offer.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{offer.title} · {offer.store === "STEAM" ? "Steam" : "Epic"}</p>
                  <p className="text-xs text-muted">{formatDateTimeFr(offer.startsAt)} – {formatDateTimeFr(offer.endsAt)}</p>
                </div>
                <form action={deleteFreeGameOfferAction}>
                  <input type="hidden" name="communityId" value={selected?.id} />
                  <input type="hidden" name="id" value={offer.id} />
                  <button className="text-xs text-destructive underline">Supprimer</button>
                </form>
              </Card>
            ))}
            {offers.length === 0 && <p className="text-sm text-muted">Aucune offre enregistrée.</p>}
          </section>
        </>
      )}
    </main>
  );
}
