import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { listActiveInstantSessions, getActiveInstantSessionForUser } from "@/lib/instant-sessions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { InstantSessionCreateForm } from "@/components/jouer-maintenant/InstantSessionCreateForm";
import type { NotifyRecipientCandidate } from "@/components/NotifyRecipientsField";

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
  already_in_another_session: "Tu es déjà dans une autre session instantanée active — quitte-la d'abord.",
};

/**
 * V2 — "Jouer maintenant" : liste des sessions instantanées ACTIVES
 * (visibles/rejoignables par n'importe quel utilisateur authentifié,
 * voir le commentaire de modèle `InstantSession`, schema.prisma — pas de
 * confidentialité par invitation comme les soirées planifiées) + création.
 * Distinct de `/roulette` (tirage d'un jeu parmi des propositions) et de
 * `/sessions` (soirées planifiées à l'avance).
 */
export default async function JouerMaintenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? null) : null;

  const [activeSessions, myActiveSession, games, potesRaw] = await Promise.all([
    listActiveInstantSessions(),
    getActiveInstantSessionForUser(user.id),
    prisma.game.findMany({ select: { id: true, name: true, igdbId: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { id: { not: user.id } },
      select: { id: true, discordName: true, discordAvatar: true, color: true },
      orderBy: { discordName: "asc" },
    }),
  ]);
  const potes: NotifyRecipientCandidate[] = potesRaw.map((p) => ({ ...p, tagIds: [] }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🎮 Jouer maintenant</h1>
      <p className="text-sm text-muted">
        Une session spontanée, sans planification — démarre un jeu, tes potes rejoignent librement
        tant qu&apos;elle est active (3h maximum). Distinct des soirées planifiées et de la roulette.
      </p>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      {myActiveSession ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Tu es déjà dans une session instantanée active.</p>
          <Link href={`/jouer-maintenant/${myActiveSession.id}`} className="text-sm font-medium text-accent">
            Y retourner →
          </Link>
        </Card>
      ) : (
        <Card>
          <InstantSessionCreateForm localGames={games} potes={potes} />
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">
          Sessions actives ({activeSessions.length})
        </h2>
        {activeSessions.length === 0 ? (
          <EmptyState icon="🎮" title="Aucune session instantanée en cours." />
        ) : (
          <ul className="flex flex-col gap-2">
            {activeSessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/jouer-maintenant/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      src={s.createdBy.discordAvatar}
                      alt=""
                      size={36}
                      ringColor={s.createdBy.color}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{s.game.name}</p>
                      <p className="text-xs text-muted">
                        {s.presence.length} participant{s.presence.length === 1 ? "" : "s"} · par{" "}
                        {s.createdBy.discordName}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
