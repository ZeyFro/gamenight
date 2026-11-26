import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";
import { isVercelPreview } from "@/lib/preview-safety";
import TowerWelcomePanelPublisher from "@/components/admin/TowerWelcomePanelPublisher";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panneau d'accueil — administration The Tower" };

export default async function TowerWelcomePanelAdminPage() {
  if (isVercelPreview()) redirect("/");
  const admin = await requireAdmin();
  if (!admin || !isTowerOwner(admin.discordId)) redirect("/");

  const channelId = process.env.TOWER_DISCORD_WELCOME_CHANNEL_ID ?? "";
  const enabled = process.env.TOWER_ONBOARDING_PANEL_ENABLED === "true" &&
    process.env.TOWER_DISCORD_GUILD_ID === towerGuildId() &&
    /^\d{17,20}$/.test(channelId);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">The Tower · Administration</p>
        <h1 className="text-2xl font-semibold">Panneau d'accueil Discord</h1>
        <p className="text-sm text-muted">Publication manuelle réservée au propriétaire. Aucun message n'est envoyé par cron ou lors d'un déploiement.</p>
      </header>
      <TowerWelcomePanelPublisher enabled={enabled} />
    </main>
  );
}
