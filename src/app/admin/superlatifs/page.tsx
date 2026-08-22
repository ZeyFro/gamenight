import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { AuditLine } from "@/components/AuditLine";
import { SuperlativeCategoryForm } from "@/components/SuperlativeCategoryForm";
import {
  addSuperlativeCategory,
  deleteSuperlativeCategory,
  toggleSuperlativeCategoryActive,
  updateSuperlativeCategory,
} from "./actions";

/**
 * Vote de superlatifs entre potes (PR 5/9, version light) — remplace
 * `/admin/jeux-stats` dans la navigation (laissée dormante, cf. le
 * commentaire sur `GameStatType` dans schema.prisma). Superlatifs
 * génériques, pas de config par jeu : une seule liste plate, comme
 * `/admin/messages`. Même esprit : pas de rôle admin dédié, tout le monde
 * peut gérer cette liste, traçabilité via `AuditLine` seulement.
 */
export default async function SuperlatifsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const categories = await prisma.superlativeCategory.findMany({
    include: { modifiedBy: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Superlatifs
        </h1>
        <p className="mt-1 text-sm text-muted">
          Les titres que le groupe peut voter après chaque soirée (MVP, le
          plus mort, le plus drôle…) et l&apos;XP bonus qu&apos;ils
          rapportent. Pas de rôle admin dédié : tout le monde peut gérer
          cette liste.
        </p>
      </div>

      <Card>
        <SuperlativeCategoryForm
          action={addSuperlativeCategory}
          idPrefix="new"
          footer={
            <Button type="submit" variant="primary" fullWidthOnMobile>
              Ajouter
            </Button>
          }
        />
      </Card>

      {categories.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucun superlatif pour l&apos;instant.
          </p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {categories.map((category) => (
            <StaggerItem key={category.id}>
              <Card className="flex flex-col gap-4">
                <SuperlativeCategoryForm
                  action={updateSuperlativeCategory}
                  idValue={category.id}
                  idPrefix={category.id}
                  initialIcon={category.icon}
                  initialName={category.name}
                  initialDescription={category.description ?? ""}
                  initialXpReward={category.xpReward}
                  footer={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={category.active ? "accent" : "neutral"}>
                        {category.active ? "Actif" : "Désactivé"}
                      </Badge>
                      <Button type="submit" variant="secondary" size="sm">
                        Enregistrer
                      </Button>
                    </div>
                  }
                />

                <div className="flex gap-2">
                  <form
                    action={toggleSuperlativeCategoryActive}
                    className="flex-1"
                  >
                    <input type="hidden" name="id" value={category.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      fullWidthOnMobile
                    >
                      {category.active ? "Désactiver" : "Réactiver"}
                    </Button>
                  </form>
                  <form action={deleteSuperlativeCategory} className="flex-1">
                    <input type="hidden" name="id" value={category.id} />
                    <Button
                      type="submit"
                      variant="destructive"
                      size="sm"
                      fullWidthOnMobile
                    >
                      Supprimer
                    </Button>
                  </form>
                </div>

                <AuditLine
                  discordName={category.modifiedBy.discordName}
                  discordAvatar={category.modifiedBy.discordAvatar}
                  date={category.modifiedAt}
                />
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
