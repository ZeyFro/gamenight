import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { AdminTabs, ADMIN_TAB_KEYS, type AdminTabKey } from "@/components/admin/AdminTabs";
import { MessagesTab } from "@/components/admin/MessagesTab";
import { SuperlativesTab } from "@/components/admin/SuperlativesTab";
import { BadgesTab } from "@/components/admin/BadgesTab";
import { JeuxStatsTab } from "@/components/admin/JeuxStatsTab";
import { ReglagesTab } from "@/components/admin/ReglagesTab";
import { ConfidentialiteTab } from "@/components/admin/ConfidentialiteTab";
import { NettoyageTab } from "@/components/admin/NettoyageTab";

function isAdminTabKey(value: string | undefined): value is AdminTabKey {
  return !!value && (ADMIN_TAB_KEYS as string[]).includes(value);
}

/**
 * Hub d'administration (PR 8/9) — remplace les 4 pages individuelles
 * (`/admin/messages`, `/admin/superlatifs`, `/admin/badges`,
 * `/admin/jeux-stats`) qui devenaient longues à scroller séparément
 * (30+ messages avec les 7 catégories actives). Onglet piloté par
 * `?tab=`, pas de sous-route : les anciennes URLs redirigent ici
 * (`permanentRedirect`, voir les fichiers `page.tsx` correspondants).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const { tab: tabRaw } = await searchParams;
  const tab: AdminTabKey = isAdminTabKey(tabRaw) ? tabRaw : "messages";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Administration
        </h1>
        <p className="mt-1 text-sm text-muted">
          Réservé aux admins du groupe.
        </p>
      </div>

      <AdminTabs active={tab} />

      {tab === "messages" && <MessagesTab />}
      {tab === "superlatifs" && <SuperlativesTab />}
      {tab === "badges" && <BadgesTab />}
      {tab === "jeux-stats" && <JeuxStatsTab />}
      {tab === "reglages" && <ReglagesTab />}
      {tab === "confidentialite" && <ConfidentialiteTab />}
      {tab === "nettoyage" && <NettoyageTab />}
    </div>
  );
}
