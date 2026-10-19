import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { getShopState, XP_SHOP_ITEMS } from "@/lib/xp-shop";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { buyShopItemAction, equipShopItemAction } from "./actions";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Boutique XP");

const KIND_LABELS = { TITLE: "Titres", FRAME: "Cadres", COLOR: "Couleurs" };
const STATUS_MESSAGES: Record<string, string> = {
  purchased: "Achat effectué.",
  owned: "Tu possèdes déjà cet objet.",
  insufficient: "Ton solde XP est insuffisant.",
  equipped: "Équipement mis à jour.",
  not_owned: "Tu dois posséder cet objet pour l’équiper.",
  invalid: "Objet invalide.",
  unavailable: "Cette communauté n’est plus accessible.",
  no_community: "Choisis une communauté pour utiliser sa réserve d’XP.",
};

export default async function XpShopPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await writeCommunityIdForUser(user.id);
  if (!communityId) redirect("/profil");
  const [{ balance, ownedIds, equipped }, query] = await Promise.all([
    getShopState(user.id, communityId),
    searchParams,
  ]);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Boutique XP</h2>
        <p className="mt-1 text-sm text-muted">Solde dépensable de cette communauté : {balance} XP</p>
        <p className="mt-1 text-sm text-muted">Les achats conservent ta progression, ton niveau et ton grade.</p>
      </div>
      {query.status && STATUS_MESSAGES[query.status] && (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm text-foreground">
          {STATUS_MESSAGES[query.status]}
        </p>
      )}
      {(["TITLE", "FRAME", "COLOR"] as const).map((kind) => (
        <section key={kind} className="flex flex-col gap-3" aria-labelledby={`shop-${kind}`}>
          <h3 id={`shop-${kind}`} className="text-lg font-semibold text-foreground">{KIND_LABELS[kind]}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {XP_SHOP_ITEMS.filter((item) => item.kind === kind).map((item) => {
              const owned = ownedIds.has(item.id);
              const isEquipped = equipped[kind] === item.id;
              return (
                <Card key={item.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground" style={kind === "COLOR" ? { color: item.value } : undefined}>{item.name}</p>
                    <p className="text-sm text-muted">{owned ? "Possédé" : `${item.price} XP`}{isEquipped ? " · Équipé" : ""}</p>
                  </div>
                  {owned ? (
                    <form action={equipShopItemAction} className="flex shrink-0 gap-2">
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <Button type="submit" size="sm" variant={isEquipped ? "secondary" : "primary"} disabled={isEquipped} aria-label={`Équiper ${item.name}`}>
                        {isEquipped ? "Équipé" : "Équiper"}
                      </Button>
                    </form>
                  ) : (
                    <form action={buyShopItemAction} className="shrink-0">
                      <input type="hidden" name="itemId" value={item.id} />
                      <Button type="submit" size="sm" variant="secondary" aria-label={`Acheter ${item.name} pour ${item.price} XP`}>Acheter</Button>
                    </form>
                  )}
                </Card>
              );
            })}
          </div>
          {equipped[kind] && (
            <form action={equipShopItemAction}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="itemId" value="" />
              <Button type="submit" size="sm" variant="ghost">Retirer l’équipement</Button>
            </form>
          )}
        </section>
      ))}
    </section>
  );
}
