"use client";

import { useMemo, useState } from "react";
import type { MessageCategory } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { MessageTemplateForm } from "@/components/MessageTemplateForm";
import { AuditLine } from "@/components/AuditLine";
import { ALL_MESSAGE_CATEGORIES, CATEGORY_LABELS } from "@/lib/message-templates";

export interface MessageListItem {
  id: string;
  text: string;
  categories: MessageCategory[];
  active: boolean;
  createdByName: string;
  modifiedByName: string;
  modifiedByAvatar: string | null;
  modifiedAt: Date;
}

/**
 * Liste + sous-filtres par catégorie (PR 8/9, bonus demandé pour l'onglet
 * Messages du hub /admin) — même pattern que les filtres déjà en place
 * (`BibliothequeGrid`, `TierlistBoard`) : état client, filtrage en
 * mémoire, rien de plus. Une catégorie sans aucun message n'apparaît pas
 * dans les pastilles (pas de filtre qui viderait toujours la liste).
 */
export function MessagesList({
  templates,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  templates: MessageListItem[];
  updateAction: (formData: FormData) => Promise<void>;
  toggleAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [filter, setFilter] = useState<MessageCategory | "ALL">("ALL");

  const filtered = useMemo(
    () => (filter === "ALL" ? templates : templates.filter((t) => t.categories.includes(filter))),
    [templates, filter]
  );

  const categoriesWithCount = ALL_MESSAGE_CATEGORIES.map((category) => ({
    category,
    count: templates.filter((t) => t.categories.includes(category)).length,
  })).filter(({ count }) => count > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === "ALL"
              ? "bg-accent text-accent-foreground"
              : "border border-border text-muted hover:text-foreground"
          }`}
        >
          Toutes ({templates.length})
        </button>
        {categoriesWithCount.map(({ category, count }) => (
          <button
            key={category}
            type="button"
            onClick={() => setFilter(category)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === category
                ? "bg-accent text-accent-foreground"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {CATEGORY_LABELS[category]} ({count})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Aucun message dans cette catégorie.</p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {filtered.map((t) => (
            <StaggerItem key={t.id}>
              <Card className="flex flex-col gap-4">
                <MessageTemplateForm
                  action={updateAction}
                  idValue={t.id}
                  idPrefix={t.id}
                  initialText={t.text}
                  initialCategories={t.categories}
                  footer={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span>Créé par {t.createdByName}</span>
                        <Badge tone={t.active ? "accent" : "neutral"}>
                          {t.active ? "Actif" : "Désactivé"}
                        </Badge>
                      </div>
                      <Button type="submit" variant="secondary" size="sm">
                        Enregistrer
                      </Button>
                    </div>
                  }
                />

                <div className="flex gap-2">
                  <form action={toggleAction} className="flex-1">
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" variant="secondary" size="sm" fullWidthOnMobile>
                      {t.active ? "Désactiver" : "Réactiver"}
                    </Button>
                  </form>
                  <form action={deleteAction} className="flex-1">
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" variant="destructive" size="sm" fullWidthOnMobile>
                      Supprimer
                    </Button>
                  </form>
                </div>

                <AuditLine
                  discordName={t.modifiedByName}
                  discordAvatar={t.modifiedByAvatar}
                  date={t.modifiedAt}
                />
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
