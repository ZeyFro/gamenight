import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { steamPrivacySettingsUrl } from "@/lib/steam";
import { reimportSteamLibrary } from "@/app/actions";

export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ steam?: string; count?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { steam, count } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Accueil
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          Mon profil
        </h1>
      </div>

      <div className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-950">
        {user.discordAvatar && (
          <Image
            src={user.discordAvatar}
            alt={`Avatar de ${user.discordName}`}
            width={56}
            height={56}
            className="rounded-full"
          />
        )}
        <div>
          <p className="font-semibold text-zinc-950 dark:text-zinc-50">
            {user.discordName}
          </p>
          <p className="text-sm text-zinc-500">Connecté via Discord</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-950">
        <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Compte Steam
        </h2>

        {steam === "erreur" && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            La vérification Steam a échoué. Réessaie.
          </p>
        )}
        {steam === "importe" && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            Bibliothèque Steam importée
            {count ? ` (${count} jeu${count === "1" ? "" : "x"})` : ""}.
          </p>
        )}
        {steam === "prive" && user.steamId64 && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
            Ton profil Steam est privé, la bibliothèque ne peut pas être
            importée.{" "}
            <a
              href={steamPrivacySettingsUrl(user.steamId64)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Régler la confidentialité de mon profil Steam
            </a>
            , puis réimporte depuis cette page.
          </p>
        )}

        {user.steamId64 ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Compte Steam lié ({user.steamId64}) — bibliothèque{" "}
              {user.steamPublic ? "publique" : "privée ou inconnue"}.
            </p>
            <form action={reimportSteamLibrary}>
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Réimporter ma bibliothèque Steam
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Lie ton compte Steam pour importer automatiquement les jeux que
              tu possèdes.
            </p>
            <a
              href="/api/steam/link"
              className="self-start rounded-full bg-[#1b2838] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2a3f5a]"
            >
              Lier mon compte Steam
            </a>
          </>
        )}
      </div>

      <Link
        href="/bibliotheque"
        className="self-start text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
      >
        Voir ma bibliothèque de jeux →
      </Link>
    </div>
  );
}
