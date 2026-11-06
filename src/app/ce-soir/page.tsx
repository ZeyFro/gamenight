import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getPlayerClassifiedCommunityId } from "@/lib/player-classifieds";
import { getTonightBoard } from "@/lib/tonight";
import { TONIGHT_MAX_GAMES, TONIGHT_NOTE_MAX_LENGTH, isTonightEnabled } from "@/lib/tonight-rules";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { clearTonightAction, declareTonightAction } from "./actions";

export const metadata = pageMetadata("Qui joue ce soir ?");

const ERRORS: Record<string, string> = {
  unavailable: "Les annonces de joueurs ne sont pas disponibles dans ta communauté.",
  invalid: "Choisis 1 à 3 jeux différents (note de 200 caractères maximum).",
  rate_limited: "Trop de demandes, réessaie dans une minute.",
};

export default async function TonightPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; declared?: string }>;
}) {
  if (!isTonightEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-xl font-semibold text-foreground">🌙 Qui joue ce soir ?</h1>
        <Card className="text-sm text-muted">{ERRORS.unavailable}</Card>
        <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Jouer maintenant →</Link>
      </main>
    );
  }

  const [{ error, declared }, games, board] = await Promise.all([
    searchParams,
    prisma.game.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getTonightBoard(user.id, communityId, wallClockNow()),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🌙 Qui joue ce soir ?</h1>
        <p className="mt-1 text-sm text-muted">
          Dis en un clic à quoi tu peux jouer ce soir. Visible par les membres actifs de ta communauté jusqu’à 4 h du matin, sans notification Discord.
        </p>
      </div>

      {error && ERRORS[error] && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{ERRORS[error]}</p>}
      {declared && !error && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">C’est noté : tu es dispo ce soir.</p>}

      <Card>
        <form action={declareTonightAction} className="flex flex-col gap-3">
          {Array.from({ length: TONIGHT_MAX_GAMES }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <label htmlFor={`tonight-game-${i}`} className="text-sm font-medium text-foreground">
                {i === 0 ? "Jeu" : "Autre jeu (facultatif)"}
              </label>
              <select
                id={`tonight-game-${i}`}
                name="gameId"
                required={i === 0}
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground"
              >
                <option value="">{i === 0 ? "Choisir un jeu" : "—"}</option>
                {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
              </select>
            </div>
          ))}
          <label htmlFor="tonight-note" className="text-sm font-medium text-foreground">Note (facultatif)</label>
          <input id="tonight-note" name="note" maxLength={TONIGHT_NOTE_MAX_LENGTH} placeholder="Dispo dès 21 h, micro OK" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
          <Button type="submit" variant="primary">Je suis dispo ce soir</Button>
        </form>
        {board.myGames.length > 0 && (
          <form action={clearTonightAction} className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
            <span>Tu es dispo pour : {board.myGames.join(", ")}</span>
            <button type="submit" className="text-xs text-destructive underline">Je ne suis plus dispo</button>
          </form>
        )}
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="tonight-players-title">
        <h2 id="tonight-players-title" className="text-sm font-medium text-foreground">Joueurs dispo ce soir</h2>
        {board.players.length === 0 ? <EmptyState icon="🌙" title="Personne ne s’est encore déclaré." /> : (
          <ul className="flex flex-col gap-2">
            {board.players.map((group) => (
              <li key={group.game}>
                <Card className="flex flex-col gap-1">
                  <p className="font-medium text-foreground">{group.game} · {group.players.length} joueur{group.players.length > 1 ? "s" : ""}</p>
                  <p className="text-sm text-muted">
                    {group.players.map((p) => (p.note ? `${p.discordName} (${p.note})` : p.discordName)).join(" · ")}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="tonight-instant-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tonight-instant-title" className="text-sm font-medium text-foreground">Parties en cours</h2>
          <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Lancer une partie →</Link>
        </div>
        {board.instantSessions.length === 0 ? <p className="text-sm text-muted">Aucune partie en cours.</p> : (
          <ul className="flex flex-col gap-2">
            {board.instantSessions.map((s) => (
              <li key={s.id}>
                <Link href={`/jouer-maintenant/${s.id}`}>
                  <Card className="text-sm text-foreground">{s.game} · lancée par {s.createdBy} · {s.present} présent{s.present > 1 ? "s" : ""}</Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="tonight-sessions-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tonight-sessions-title" className="text-sm font-medium text-foreground">Tes soirées de ce soir</h2>
          <Link href="/sessions" className="text-sm font-medium text-accent">Toutes les soirées →</Link>
        </div>
        {board.sessions.length === 0 ? <p className="text-sm text-muted">Aucune soirée prévue ce soir pour toi.</p> : (
          <ul className="flex flex-col gap-2">
            {board.sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/sessions/${s.id}`}>
                  <Card className="text-sm text-foreground">
                    {formatDateTimeFr(s.date)} · {s.decidedGame?.name ?? (s.status === "VOTING" ? "vote en cours" : "jeu à choisir")}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
