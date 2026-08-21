import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  ALL_MESSAGE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_VARIABLES,
} from "@/lib/message-templates";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import type { MessageCategory } from "@prisma/client";
import {
  addMessageTemplate,
  deleteMessageTemplate,
  toggleMessageTemplateActive,
  updateMessageTemplate,
} from "./actions";

function CategoryCheckboxes({
  idPrefix,
  selected,
}: {
  idPrefix: string;
  selected: MessageCategory[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs text-muted">
        Catégories (tirage aléatoire pour l&apos;envoi correspondant)
      </legend>
      {ALL_MESSAGE_CATEGORIES.map((category) => {
        const id = `${idPrefix}-${category}`;
        return (
          <label
            key={category}
            htmlFor={id}
            className="flex items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          >
            <input
              id={id}
              type="checkbox"
              name={`category-${category}`}
              defaultChecked={selected.includes(category)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-border accent-accent"
            />
            <span>
              {CATEGORY_LABELS[category]}
              <span className="mt-0.5 block text-xs text-faint">
                Variables :{" "}
                {CATEGORY_VARIABLES[category].map((v) => `{${v}}`).join(", ")}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default async function MessagesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const templates = await prisma.messageTemplate.findMany({
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Messages Discord
        </h1>
        <p className="mt-1 text-sm text-muted">
          Tirés au hasard pour les rappels avant soirée, et les
          notifications de création/modification de session. Coche les
          catégories où un message peut être utilisé — chaque envoi tire
          au hasard parmi les messages actifs de sa catégorie. Pas de rôle
          admin dédié : tout le monde peut gérer cette liste.
        </p>
      </div>

      <Card>
        <form action={addMessageTemplate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted" htmlFor="new-template">
              Nouveau message
            </label>
            <textarea
              id="new-template"
              name="text"
              rows={2}
              required
              placeholder="Ex. : Yo {pote}, dans 30 min c'est {jeu}."
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>
          <CategoryCheckboxes idPrefix="new" selected={[]} />
          <Button type="submit" variant="primary" fullWidthOnMobile>
            Ajouter
          </Button>
        </form>
      </Card>

      {templates.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Aucun message pour l&apos;instant.</p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {templates.map((t) => (
            <StaggerItem key={t.id}>
              <Card className="flex flex-col gap-4">
                <form
                  action={updateMessageTemplate}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="id" value={t.id} />
                  <textarea
                    name="text"
                    defaultValue={t.text}
                    rows={2}
                    required
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                  />
                  <CategoryCheckboxes idPrefix={t.id} selected={t.categories} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>Créé par {t.createdBy.discordName}</span>
                      <Badge tone={t.active ? "accent" : "neutral"}>
                        {t.active ? "Actif" : "Désactivé"}
                      </Badge>
                    </div>
                    <Button type="submit" variant="secondary" size="sm">
                      Enregistrer
                    </Button>
                  </div>
                </form>

                <div className="flex gap-2">
                  <form action={toggleMessageTemplateActive} className="flex-1">
                    <input type="hidden" name="id" value={t.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      fullWidthOnMobile
                    >
                      {t.active ? "Désactiver" : "Réactiver"}
                    </Button>
                  </form>
                  <form action={deleteMessageTemplate} className="flex-1">
                    <input type="hidden" name="id" value={t.id} />
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
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
