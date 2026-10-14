import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { ForceReloginCard } from "@/components/admin/ForceReloginCard";

/** Onglet "Réglages" du hub /admin — actions globales exceptionnelles (pour l'instant, une seule : reconnexion forcée). */
export async function ReglagesTab() {
  const lastTriggered = await prisma.user.findFirst({
    where: { forceReloginAt: { not: null } },
    orderBy: { forceReloginAt: "desc" },
    select: { forceReloginAt: true },
  });

  const lastTriggeredLabel = lastTriggered?.forceReloginAt
    ? formatDateTimeFr(lastTriggered.forceReloginAt)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Actions globales exceptionnelles, à ne déclencher qu&apos;en
        connaissance de cause.
      </p>

      <ForceReloginCard lastTriggeredLabel={lastTriggeredLabel} />
    </div>
  );
}
