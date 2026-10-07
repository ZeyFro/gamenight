import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge as BadgeUI } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { AuditLine } from "@/components/AuditLine";
import { BadgeForm } from "@/components/admin/BadgeForm";
import { CRITERIA_TYPE_LABELS } from "@/lib/badge-rarity";
import type { BadgeCriteria } from "@/lib/badges";
import { addBadge, deleteBadge, toggleBadgeActive, updateBadge } from "@/app/admin/badges/actions";

/** Onglet "Badges" du hub /admin (PR 8/9) — nouveau, badges n'avaient pas de CRUD avant cette PR. */
export async function BadgesTab() {
  const badges = await prisma.badge.findMany({
    include: { modifiedBy: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Achievements automatiques, débloqués sans action volontaire (voir
        le README). Pas de rôle admin dédié : tout le monde peut gérer
        cette liste.
      </p>

      <Card>
        <BadgeForm
          action={addBadge}
          idPrefix="new"
          footer={
            <Button type="submit" variant="primary" fullWidthOnMobile>
              Ajouter
            </Button>
          }
        />
      </Card>

      {badges.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Aucun badge pour l&apos;instant.</p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {badges.map((badge) => {
            const criteria = badge.criteria as unknown as BadgeCriteria;
            return (
              <StaggerItem key={badge.id}>
                <Card className="flex flex-col gap-4">
                  <BadgeForm
                    action={updateBadge}
                    idValue={badge.id}
                    idPrefix={badge.id}
                    initialName={badge.name}
                    initialIcon={badge.icon}
                    initialDescription={badge.description}
                    initialCategory={badge.category}
                    initialRarity={badge.rarity}
                    initialCriteriaType={criteria.type}
                    initialCriteriaCount={criteria.count}
                    initialXpReward={badge.xpReward}
                    footer={
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-muted">
                          <span>{CRITERIA_TYPE_LABELS[criteria.type]} ≥ {criteria.count}</span>
                          <BadgeUI tone={badge.active ? "accent" : "neutral"}>
                            {badge.active ? "Actif" : "Désactivé"}
                          </BadgeUI>
                        </div>
                        <Button type="submit" variant="secondary" size="sm">
                          Enregistrer
                        </Button>
                      </div>
                    }
                  />

                  <div className="flex gap-2">
                    <form action={toggleBadgeActive} className="flex-1">
                      <input type="hidden" name="id" value={badge.id} />
                      <Button type="submit" variant="secondary" size="sm" fullWidthOnMobile>
                        {badge.active ? "Désactiver" : "Réactiver"}
                      </Button>
                    </form>
                    <form action={deleteBadge} className="flex-1">
                      <input type="hidden" name="id" value={badge.id} />
                      <Button type="submit" variant="destructive" size="sm" fullWidthOnMobile>
                        Archiver
                      </Button>
                    </form>
                  </div>

                  <AuditLine
                    discordName={badge.modifiedBy.discordName}
                    discordAvatar={badge.modifiedBy.discordAvatar}
                    date={badge.modifiedAt}
                  />
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
