import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { adminDashboardV2Enabled, loadAdminDashboardV2, type Capacity } from "@/lib/admin-dashboard-v2";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Tableau de bord · Admin");

const dateFr = (value: Date) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(value);

const LEVEL_LABEL: Record<Capacity["level"], string> = { ok: "OK", alert: "À surveiller (80 %)", full: "Limite atteinte", unavailable: "Indisponible" };

function CapacityLine({ label, capacity }: { label: string; capacity: Capacity }) {
  return (
    <li className="flex justify-between gap-4 border-b border-border py-2 text-sm">
      <span>{label}</span>
      <span className={capacity.level === "full" || capacity.level === "alert" ? "font-medium text-destructive" : "text-muted"}>
        {capacity.count === null ? "—" : `${capacity.count} / ${capacity.limit}`} · {LEVEL_LABEL[capacity.level]}
      </span>
    </li>
  );
}

export default async function AdminDashboardV2Page() {
  if (!adminDashboardV2Enabled()) notFound();
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const dashboard = await loadAdminDashboardV2();
  const { totals } = dashboard;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Tableau de bord staff</h1>
        <p className="mt-1 text-sm text-muted">
          Lecture seule, réservé aux admins : aucune action n’est possible ici, aucun secret ni contenu Discord n’est affiché. Généré le {dateFr(dashboard.generatedAt)}.
        </p>
      </div>

      <section aria-label="Résumé" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Candidatures en attente", totals.pendingApplications],
          ["Opérations Discord échouées", totals.failedOperations],
          ["Espaces à nettoyer", totals.archivedSpaces],
          ["Contestations ouvertes", totals.openAppeals],
          ["… dont en retard", totals.overdueAppeals],
        ].map(([label, value]) => (
          <Card key={label as string} className="flex flex-col gap-1 p-3">
            <span className="text-2xl font-semibold text-foreground">{value}</span>
            <span className="text-xs text-muted">{label}</span>
          </Card>
        ))}
      </section>

      {dashboard.roleCapacityAlerts > 0 && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          Alerte /role : le seuil de 80 % de 250 rôles a été atteint {dashboard.roleCapacityAlerts} jour(s) cette semaine.
        </p>
      )}

      {dashboard.communities.length === 0 && <Card className="text-sm text-muted">Aucune communauté active.</Card>}
      {dashboard.communities.map((community) => (
        <Card key={community.id} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{community.name}</h2>
          <ul>
            <li className="flex justify-between gap-4 border-b border-border py-2 text-sm"><span>Candidatures d’équipe en attente</span><span>{community.pendingApplications}</span></li>
            <li className="flex justify-between gap-4 border-b border-border py-2 text-sm"><span>Contestations Tower ouvertes (en retard)</span><span>{community.openAppeals} ({community.overdueAppeals})</span></li>
            <li className="flex justify-between gap-4 border-b border-border py-2 text-sm"><span>Opérations Discord échouées</span><span>{community.failedOperations}</span></li>
            <CapacityLine label="Rôles Discord" capacity={community.roles} />
            <CapacityLine label="Salons Discord" capacity={community.channels} />
          </ul>
          <div>
            <h3 className="text-sm font-medium text-foreground">Espaces d’équipe archivés à nettoyer</h3>
            {community.archivedSpaces.length === 0 ? (
              <p className="text-sm text-muted">Aucun. (Le code ne supprime jamais un salon ou un rôle : le nettoyage reste manuel.)</p>
            ) : (
              <ul className="mt-1 text-sm">
                {community.archivedSpaces.map((space) => (
                  <li key={`${space.teamName}-${space.archivedAt.toISOString()}`} className="border-b border-border py-1">
                    {space.teamName} · archivé le {dateFr(space.archivedAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ))}

      <section>
        <h2 className="font-semibold">{dashboard.failedOperations.length} dernières opérations Discord échouées</h2>
        {dashboard.failedOperations.length === 0 ? (
          <p className="text-sm text-muted">Aucun échec retrouvé ; cela ne garantit pas une livraison réussie.</p>
        ) : (
          <ul>
            {dashboard.failedOperations.map((item, index) => (
              <li key={index} className="border-b border-border py-2 text-sm">
                {dateFr(item.createdAt)} · {item.communityName} · {item.eventType} · {item.errorClass} · {item.attempts} tentative(s)
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/admin" className="text-accent underline">Retour à l’administration</Link>
    </main>
  );
}
