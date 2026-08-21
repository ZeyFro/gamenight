import Image from "next/image";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Une erreur inattendue est survenue côté serveur pendant la connexion. Réessaie — si ça persiste, préviens l'admin.",
  AccessDenied: "La connexion a été refusée.",
  OAuthCallbackError:
    "La connexion Discord a échoué (lien de connexion expiré ou déjà utilisé). Réessaie.",
  Verification: "Le lien de connexion n'est plus valide. Réessaie.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  const { error } = await searchParams;
  const errorMessage = error
    ? (AUTH_ERROR_MESSAGES[error] ??
      "La connexion a échoué. Réessaie dans un instant.")
    : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 font-sans sm:px-6 dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl bg-white p-6 text-center shadow-sm sm:p-10 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          GameNight
        </h1>

        {errorMessage && (
          <p className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {errorMessage}
          </p>
        )}

        {session?.user ? (
          <>
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={`Avatar de ${session.user.name}`}
                width={80}
                height={80}
                className="rounded-full"
              />
            )}
            <p className="text-lg text-zinc-800 dark:text-zinc-200">
              Connecté en tant que{" "}
              <span className="font-semibold">{session.user.name}</span>
            </p>
            <div className="flex w-full flex-col gap-3 text-base font-medium sm:w-auto sm:flex-row sm:text-sm">
              <Link
                href="/profil"
                className="rounded-full border border-zinc-300 px-4 py-3 text-center text-zinc-800 transition-colors hover:bg-zinc-100 sm:py-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Mon profil
              </Link>
              <Link
                href="/bibliotheque"
                className="rounded-full border border-zinc-300 px-4 py-3 text-center text-zinc-800 transition-colors hover:bg-zinc-100 sm:py-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Ma bibliothèque
              </Link>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
              className="w-full sm:w-auto"
            >
              <button
                type="submit"
                className="w-full rounded-full border border-zinc-300 px-5 py-3 text-base font-medium text-zinc-800 transition-colors hover:bg-zinc-100 sm:w-auto sm:py-2.5 sm:text-sm dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Se déconnecter
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Connecte-toi avec ton compte Discord pour organiser la
              prochaine soirée jeux.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("discord");
              }}
              className="w-full"
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#5865F2] px-5 py-3 text-base font-medium text-white transition-colors hover:bg-[#4752c4] sm:py-2.5 sm:text-sm"
              >
                Se connecter avec Discord
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
