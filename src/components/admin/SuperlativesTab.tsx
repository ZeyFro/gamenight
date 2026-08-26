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
} from "@/app/admin/superlatifs/actions";

/** Onglet "Superlatifs" du hub /admin — contenu déplacé depuis l'ancien `/admin/superlatifs`. */
export async function SuperlativesTab() {
  const categories = await prisma.superlativeCategory.findMany({
    include: { modifiedBy: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Les titres que le groupe peut voter après chaque soirée (MVP, le
        plus mort, le plus drôle…) et l&apos;XP bonus qu&apos;ils
        rapportent. Pas de rôle admin dédié : tout le monde peut gérer
        cette liste.
      </p>

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
          <p className="text-sm text-muted">Aucune récompense pour l&apos;instant.</p>
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
                  <form action={toggleSuperlativeCategoryActive} className="flex-1">
                    <input type="hidden" name="id" value={category.id} />
                    <Button type="submit" variant="secondary" size="sm" fullWidthOnMobile>
                      {category.active ? "Désactiver" : "Réactiver"}
                    </Button>
                  </form>
                  <form action={deleteSuperlativeCategory} className="flex-1">
                    <input type="hidden" name="id" value={category.id} />
                    <Button type="submit" variant="destructive" size="sm" fullWidthOnMobile>
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
