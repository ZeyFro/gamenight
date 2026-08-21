import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { AjouterJeuForm } from "@/components/AjouterJeuForm";

export default async function AjouterJeuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href="/bibliotheque"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Retour à la bibliothèque
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-950 sm:text-2xl dark:text-zinc-50">
          Ajouter un jeu
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Utile pour les jeux hors Steam (Minecraft, modpacks type ATM11…) :
          l&apos;ajout manuel est indispensable pour eux.
        </p>
      </div>

      <AjouterJeuForm />
    </div>
  );
}
