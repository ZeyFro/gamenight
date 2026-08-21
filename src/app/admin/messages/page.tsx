import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { MessageTemplateForm } from "@/components/MessageTemplateForm";
import {
  addMessageTemplate,
  deleteMessageTemplate,
  toggleMessageTemplateActive,
  updateMessageTemplate,
} from "./actions";

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
        <MessageTemplateForm
          action={addMessageTemplate}
          idPrefix="new"
          footer={
            <Button type="submit" variant="primary" fullWidthOnMobile>
              Ajouter
            </Button>
          }
        />
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
                <MessageTemplateForm
                  action={updateMessageTemplate}
                  idValue={t.id}
                  idPrefix={t.id}
                  initialText={t.text}
                  initialCategories={t.categories}
                  footer={
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
                  }
                />

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
