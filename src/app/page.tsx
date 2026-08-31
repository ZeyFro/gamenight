import Image from "next/image";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { closeSessionIfDue } from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/Logo";
import { Stagger, StaggerItem } from "@/components/motion";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Une erreur inattendue est survenue côté serveur pendant la connexion. Réessaie — si ça persiste, préviens l'admin.",
  AccessDenied: "La connexion a été refusée.",
  OAuthCallbackError:
    "La connexion Discord a échoué (lien de connexion expiré ou déjà utilisé). Réessaie.",
  Verification: "Le lien de connexion n'est plus valide. Réessaie.",
};

// Fix UX (PR 9/9) : ne matche que la forme exacte `/potes/<id>` — jamais
// une URL absolue ni un autre chemin — pour que `redirectTo` ne puisse
// jamais devenir un open redirect, même avant la vérification en base.
const POTE_REDIRECT_PATTERN = /^\/potes\/([a-zA-Z0-9]+)$/;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const session = await auth();
  const { error, redirect: redirectParam } = await searchParams;
  const errorMessage = error
    ? (AUTH_ERROR_MESSAGES[error] ??
      "La connexion a échoué. Réessaie dans un instant.")
    : null;

  if (!session?.user) {
    let redirectTarget: { path: string; pseudo: string } | null = null;
    const match = redirectParam ? POTE_REDIRECT_PATTERN.exec(redirectParam) : null;
    if (match) {
      const targetUser = await prisma.user.findUnique({
        where: { id: match[1] },
        select: { discordName: true },
      });
      if (targetUser) redirectTarget = { path: redirectParam!, pseudo: targetUser.discordName };
    }

    return (
      <div className="bg-hero-gradient flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <Card className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <Logo className="text-xl" />

          {errorMessage && (
            <p className="w-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <p className="text-muted">
            Connecte-toi avec ton compte Discord pour organiser la
            prochaine soirée jeux.
          </p>

          {redirectTarget && (
            <p className="w-full rounded-lg bg-accent/10 p-3 text-sm text-accent">
              Tu vas voir le profil de {redirectTarget.pseudo} après connexion.
            </p>
          )}

          <form
            action={async () => {
              "use server";
              await signIn(
                "discord",
                redirectTarget ? { redirectTo: redirectTarget.path } : undefined
              );
            }}
            className="w-full"
          >
            <Button
              type="submit"
              variant="primary"
              fullWidthOnMobile
              className="w-full gap-2 bg-[#5865F2] hover:bg-[#4752c4]"
            >
              Se connecter avec Discord
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const dueSession = await prisma.session.findFirst({
    where: { status: "VOTING", date: { lte: wallClockNow() } },
    select: { id: true },
    orderBy: { date: "asc" },
  });
  if (dueSession) await closeSessionIfDue(dueSession.id);

  const [nextSession, libraryCount, previewGames] = await Promise.all([
    prisma.session.findFirst({
      where: { status: { in: ["VOTING", "SCHEDULED"] } },
      orderBy: { date: "asc" },
      include: { decidedGame: true, _count: { select: { proposals: true } } },
    }),
    prisma.userGame.count({ where: { userId: user.id, owned: true } }),
    prisma.userGame.findMany({
      where: { userId: user.id, owned: true },
      take: 6,
      include: { game: true },
      orderBy: { game: { name: "asc" } },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        {session.user.image && (
          <Image
            src={session.user.image}
            alt={`Avatar de ${session.user.name}`}
            width={56}
            height={56}
            className="rounded-full"
          />
        )}
        <div>
          <p className="text-sm text-muted">Salut,</p>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
            {session.user.name}
          </h1>
        </div>
      </div>

      <Stagger className="flex flex-col gap-4">
        <StaggerItem>
          {nextSession ? (
            <Link href={`/sessions/${nextSession.id}`}>
              <Card glow>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted">Prochaine soirée</p>
                    <p className="mt-1 text-lg font-semibold text-foreground capitalize">
                      {formatDateTimeFr(nextSession.date)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {nextSession.decidedGame
                        ? nextSession.decidedGame.name
                        : `${nextSession._count.proposals} proposition${nextSession._count.proposals === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${SESSION_STATUS_LABELS[nextSession.status].className}`}
                  >
                    {SESSION_STATUS_LABELS[nextSession.status].label}
                  </span>
                </div>
              </Card>
            </Link>
          ) : (
            <Card>
              <p className="text-sm text-muted">
                Aucune soirée prévue pour l&apos;instant.
              </p>
              <ButtonLink href="/sessions" variant="primary" className="mt-4">
                Proposer une soirée
              </ButtonLink>
            </Card>
          )}
        </StaggerItem>

        <StaggerItem>
          <Link href="/bibliotheque">
            <Card glow>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">Ta bibliothèque</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {libraryCount} jeu{libraryCount === 1 ? "" : "x"}
                  </p>
                </div>
                {previewGames.length > 0 && (
                  <div className="flex -space-x-3">
                    {previewGames.map(({ game }) => (
                      <div
                        key={game.id}
                        className="h-12 w-9 shrink-0 overflow-hidden rounded-md border-2 border-surface bg-surface-hover"
                      >
                        {game.coverUrl && (
                          <Image
                            src={game.coverUrl}
                            alt=""
                            width={36}
                            height={48}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </Link>
        </StaggerItem>

        <StaggerItem className="grid grid-cols-2 gap-4">
          <ButtonLink href="/disponibilites" variant="secondary" size="sm">
            Mes dispos
          </ButtonLink>
          <ButtonLink href="/sessions" variant="secondary" size="sm">
            Soirées
          </ButtonLink>
        </StaggerItem>
      </Stagger>

      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <Button type="submit" variant="ghost" size="sm">
          Se déconnecter
        </Button>
      </form>
    </div>
  );
}
