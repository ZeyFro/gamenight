import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isCommandRegistrationEnabled } from "@/lib/discord-command-registration";
import { isVercelPreview } from "@/lib/preview-safety";
import { pageMetadata } from "@/lib/page-title";
import { DiscordCommandsConsole } from "@/components/admin/DiscordCommandsConsole";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Commandes Discord · Admin");

/**
 * Interface de la route `POST /api/admin/discord-commands` (remplace la console du navigateur).
 * Mêmes conditions d'existence que la route : interrupteur `DISCORD_COMMAND_REGISTRATION_ENABLED`, secret configuré,
 * jamais sur Preview (sinon 404) ; administrateur connecté (sinon redirection). La page ne lit ni n'affiche aucun secret :
 * le secret est saisi par l'administrateur et envoyé à la route en en-tête, rien d'autre (docs/SOIREE_ACTIVATION.md § 9 sexies).
 */
export default async function AdminDiscordCommandsPage() {
  if (isVercelPreview() || !isCommandRegistrationEnabled() || !process.env.DISCORD_COMMAND_REGISTRATION_SECRET?.trim()) {
    notFound();
  }
  const admin = await requireAdmin();
  if (!admin) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Commandes Discord</h1>
        <p className="mt-1 text-sm text-muted">
          Vérifie ou enregistre les commandes du bot dans The Tower avec le jeton de l’environnement : le jeton ne quitte jamais
          le serveur. Aucune commande n’est supprimée. Éteins l’interrupteur après usage.
        </p>
      </div>
      <DiscordCommandsConsole />
    </main>
  );
}
