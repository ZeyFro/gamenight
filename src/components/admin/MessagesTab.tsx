import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MessageTemplateForm } from "@/components/MessageTemplateForm";
import { MessagesList } from "@/components/admin/MessagesList";
import {
  addMessageTemplate,
  deleteMessageTemplate,
  toggleMessageTemplateActive,
  updateMessageTemplate,
} from "@/app/admin/messages/actions";

/** Onglet "Messages Discord" du hub /admin — contenu déplacé depuis l'ancien `/admin/messages`. */
export async function MessagesTab() {
  const templates = await prisma.messageTemplate.findMany({
    include: { createdBy: true, modifiedBy: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Tirés au hasard pour les rappels avant soirée, et les notifications
        de création/modification de session. Coche les catégories où un
        message peut être utilisé — chaque envoi tire au hasard parmi les
        messages actifs de sa catégorie. Pas de rôle admin dédié : tout le
        monde peut gérer cette liste.
      </p>

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
        <MessagesList
          templates={templates.map((t) => ({
            id: t.id,
            text: t.text,
            categories: t.categories,
            active: t.active,
            createdByName: t.createdBy.discordName,
            modifiedByName: t.modifiedBy.discordName,
            modifiedByAvatar: t.modifiedBy.discordAvatar,
            modifiedAt: t.modifiedAt,
          }))}
          updateAction={updateMessageTemplate}
          toggleAction={toggleMessageTemplateActive}
          deleteAction={deleteMessageTemplate}
        />
      )}
    </div>
  );
}
