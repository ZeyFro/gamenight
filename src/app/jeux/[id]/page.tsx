import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getGameDetails } from "@/lib/game-details";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { EditGameDialog } from "@/components/EditGameDialog";
import { refreshGameDetails } from "../actions";

const SOURCE_LABELS: Record<string, string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "Manuel",
};

function formatReleaseDateFr(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) notFound();

  const [{ details, error }, owners, owns] = await Promise.all([
    getGameDetails(game),
    prisma.userGame.findMany({
      where: { gameId: id, owned: true },
      include: { user: true },
    }),
    prisma.userGame.findUnique({
      where: { userId_gameId: { userId: user.id, gameId: id } },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/bibliotheque"
        className="text-sm text-muted hover:text-foreground hover:underline"
      >
        ← Bibliothèque
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative aspect-[2/3] w-40 shrink-0 self-start overflow-hidden rounded-xl bg-surface-hover sm:w-52">
          {game.coverUrl && (
            <Image
              src={game.coverUrl}
              alt={game.name}
              fill
              sizes="(max-width: 640px) 160px, 208px"
              className="object-cover"
              priority
            />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {game.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{SOURCE_LABELS[game.source] ?? game.source}</Badge>
            {typeof details?.totalRating === "number" && (
              <Badge tone="accent">★ {details.totalRating}/100</Badge>
            )}
            {game.isCoop && <Badge tone="accent">Coop</Badge>}
          </div>

          <p className="text-sm text-muted">
            {game.minPlayers ?? "?"}–{game.maxPlayers ?? "?"} joueurs
            {owns && (
              <span className="ml-2 inline-block align-middle">
                <EditGameDialog game={game} />
              </span>
            )}
          </p>

          {details && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {details.releaseDate && (
                <span>📅 {formatReleaseDateFr(details.releaseDate)}</span>
              )}
              {details.genres.length > 0 && (
                <span>{details.genres.join(", ")}</span>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink href={`/sessions?gameId=${game.id}`} variant="primary">
              Proposer une soirée avec ce jeu
            </ButtonLink>
            {game.igdbId && (
              <form action={refreshGameDetails}>
                <input type="hidden" name="gameId" value={game.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Rafraîchir les infos
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>

      {!details && (
        <Card>
          <p className="text-sm text-muted">
            {error === "fetch_failed"
              ? "IGDB est injoignable pour l'instant. Réessaie plus tard avec « Rafraîchir les infos »."
              : "Pas d'infos supplémentaires trouvées."}
          </p>
        </Card>
      )}

      {details?.summary && (
        <Card>
          <h2 className="mb-2 font-semibold text-foreground">Description</h2>
          <p className="text-sm whitespace-pre-line text-muted">
            {details.summary}
          </p>
        </Card>
      )}

      {details && details.screenshotUrls.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-foreground">Captures d&apos;écran</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {details.screenshotUrls.map((url) => (
              <div
                key={url}
                className="relative aspect-video w-[280px] shrink-0 snap-start overflow-hidden rounded-lg bg-surface-hover sm:w-[360px]"
              >
                <Image
                  src={url}
                  alt={`Capture d'écran de ${game.name}`}
                  fill
                  sizes="360px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {details && details.youtubeVideoIds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-foreground">Trailer</h2>
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-hover">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${details.youtubeVideoIds[0]}`}
              title={`Trailer de ${game.name}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </section>
      )}

      {details &&
        (details.platforms.length > 0 ||
          details.developers.length > 0 ||
          details.publishers.length > 0) && (
          <Card className="flex flex-col gap-2 text-sm">
            {details.platforms.length > 0 && (
              <p>
                <span className="text-muted">Plateformes : </span>
                <span className="text-foreground">
                  {details.platforms.join(", ")}
                </span>
              </p>
            )}
            {details.developers.length > 0 && (
              <p>
                <span className="text-muted">Développeur : </span>
                <span className="text-foreground">
                  {details.developers.join(", ")}
                </span>
              </p>
            )}
            {details.publishers.length > 0 && (
              <p>
                <span className="text-muted">Éditeur : </span>
                <span className="text-foreground">
                  {details.publishers.join(", ")}
                </span>
              </p>
            )}
          </Card>
        )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">
          Qui d&apos;autre possède ce jeu
        </h2>
        {owners.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Personne ne possède ce jeu dans le groupe pour l&apos;instant.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {owners.map((o) => (
              <div key={o.userId} className="flex items-center gap-3">
                <Avatar
                  src={o.user.discordAvatar}
                  alt={o.user.discordName}
                  size={32}
                />
                <span className="text-sm text-foreground">
                  {o.user.discordName}
                  {o.userId === user.id && " (toi)"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
