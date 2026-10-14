import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { AjouterJeuForm } from "@/components/AjouterJeuForm";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Ajouter un jeu");

const ERROR_MESSAGES: Record<string, string> = {
  joueurs_invalide:
    "Le nombre de joueurs minimum doit être entre 1 et 100, et le maximum (si renseigné) doit être supérieur ou égal au minimum.",
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

export default async function AjouterJeuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error, name } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : null;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href="/bibliotheque"
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Retour à la bibliothèque
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
          Ajouter un jeu
        </h1>
        <p className="mt-1 text-sm text-muted">
          Utile pour les jeux hors Steam (Minecraft, modpacks type ATM11…) :
          l&apos;ajout manuel est indispensable pour eux.
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <AjouterJeuForm initialName={name} />
    </div>
  );
}
