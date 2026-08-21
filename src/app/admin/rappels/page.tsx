import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import {
  addReminderTemplate,
  deleteReminderTemplate,
  toggleReminderTemplateActive,
  updateReminderTemplateText,
} from "./actions";

export default async function RemindersAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const templates = await prisma.reminderTemplate.findMany({
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Messages de rappel
        </h1>
        <p className="mt-1 text-sm text-muted">
          Tirés au hasard pour les rappels Discord avant chaque soirée
          (24h et 2h). Variables : <code>{"{pote}"}</code> (mentions des
          joueurs), <code>{"{jeu}"}</code>, <code>{"{heure}"}</code>. Pas
          de rôle admin dédié : tout le monde peut gérer cette liste.
        </p>
      </div>

      <Card>
        <form action={addReminderTemplate} className="flex flex-col gap-3">
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
              <Card className="flex flex-col gap-3">
                <form
                  action={updateReminderTemplateText}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="id" value={t.id} />
                  <textarea
                    name="text"
                    defaultValue={t.text}
                    rows={2}
                    required
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                  />
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
                  <form action={toggleReminderTemplateActive} className="flex-1">
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
                  <form action={deleteReminderTemplate} className="flex-1">
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
