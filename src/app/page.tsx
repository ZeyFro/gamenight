import Image from "next/image";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          GameNight
        </h1>

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
            <div className="flex gap-3 text-sm font-medium">
              <Link
                href="/profil"
                className="rounded-full border border-zinc-300 px-4 py-2 text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Mon profil
              </Link>
              <Link
                href="/bibliotheque"
                className="rounded-full border border-zinc-300 px-4 py-2 text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Ma bibliothèque
              </Link>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
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
            >
              <button
                type="submit"
                className="flex items-center gap-2 rounded-full bg-[#5865F2] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4752c4]"
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
