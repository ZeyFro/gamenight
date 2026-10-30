import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getCommunityTeamsCommunityId, listCommunityTeams } from "@/lib/community-teams";
import { createCommunityTeamAction, joinCommunityTeamAction, leaveCommunityTeamAction, setCommunityTeamRecruitmentAction } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Équipes et aventures");

const RESULTS: Record<string, string> = {
  created: "Ton équipe est créée.", joined: "Tu as rejoint l’équipe.", already: "Tu fais déjà partie de cette équipe.",
  left: "Tu as quitté l’équipe.", leader: "Le responsable reste dans son équipe; ferme le recrutement si nécessaire.",
  closed: "Le recrutement est fermé.", full: "Cette équipe est complète.", missing: "Équipe introuvable.",
  limit: "Limite atteinte : trois équipes créées par période de 24 heures.", invalid: "Vérifie les informations saisies.",
  invalid_game: "Choisis un jeu disponible.", rate: "Trop de demandes, réessaie dans une minute.",
  unavailable: "Les équipes ne sont pas activées ou tu n’es pas membre actif de cette communauté.",
};

export default async function CommunityTeamsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getCommunityTeamsCommunityId(user.id);
  if (!communityId) {
    return <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8"><h1 className="text-2xl font-semibold">🧭 Équipes et aventures</h1><Card className="text-sm text-muted">Les équipes ne sont pas activées dans ta communauté.</Card><Link className="text-sm text-accent" href="/jouer-maintenant">Trouver une partie spontanée →</Link></main>;
  }
  const [{ result }, games, teams] = await Promise.all([
    searchParams,
    prisma.game.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
    listCommunityTeams(user.id, communityId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">🧭 Équipes et aventures</h1>
        <p className="mt-2 text-sm text-muted">Monte un projet durable, recrute des compagnons et jouez à votre rythme. Aucun ping ni message Discord n’est envoyé.</p>
      </header>
      {result && RESULTS[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p>}

      <Card>
        <h2 className="mb-3 font-semibold text-foreground">Lancer une aventure</h2>
        <form action={createCommunityTeamAction} className="grid gap-3">
          <label className="grid gap-1 text-sm text-foreground">Jeu
            <select name="gameId" required className="rounded-lg border border-border bg-background px-3 py-3 text-base">
              <option value="">Choisir un jeu</option>{games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-foreground">Nom de l’équipe ou du projet<input name="name" required minLength={3} maxLength={80} placeholder="Expédition Valheim" className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <label className="grid gap-1 text-sm text-foreground">Votre objectif<textarea name="description" required minLength={10} maxLength={1000} rows={3} placeholder="Construire une base et explorer ensemble pendant plusieurs semaines…" className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-foreground">Plateforme<input name="platform" required maxLength={40} placeholder="PC, PS5, cross-play…" className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
            <label className="grid gap-1 text-sm text-foreground">Taille totale de l’équipe (toi compris)<input name="maxMembers" type="number" required min={2} max={20} defaultValue={6} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          </div>
          <Button type="submit" variant="primary">Créer l’équipe</Button>
        </form>
      </Card>

      <section className="grid gap-3" aria-labelledby="teams-title">
        <h2 id="teams-title" className="font-semibold text-foreground">Aventures de la communauté ({teams.length})</h2>
        {teams.length === 0 ? <EmptyState icon="🧭" title="Aucune aventure en cours." /> : teams.map((team) => {
          const isMember = team.members.some((member) => member.userId === user.id);
          const leaderId = team.createdBy.memberships.length ? team.createdById : team.members[0]?.userId;
          const leaderName = team.createdBy.memberships.length ? team.createdBy.discordName : team.members[0]?.user.discordName ?? "aucun membre actif";
          const isLeader = leaderId === user.id;
          return <Card key={team.id} className="grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-semibold text-foreground">{team.name}</p><p className="text-sm text-muted">{team.game.name} · {team.platform} · {team._count.members}/{team.maxMembers} joueurs</p></div>
              <span className="text-xs text-muted">{team.isRecruiting ? "Recrutement ouvert" : "Recrutement fermé"}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{team.description}</p>
            <p className="text-xs text-muted">Responsable : {leaderName}</p>
            {isMember && <div className="grid gap-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">Score de l’équipe</p>
                <p className="text-sm font-semibold text-accent">{team.xpScore.totalXp.toLocaleString("fr-FR")} XP</p>
              </div>
              <p className="text-xs text-muted">Somme de l’XP GameNight des membres actuels dans cette communauté.</p>
              <ol className="grid gap-1">
                {team.xpScore.members.map((member, index) => <li key={member.userId} className="flex justify-between gap-3 text-sm">
                  <span className="text-foreground">{index + 1}. {member.discordName}</span>
                  <span className="whitespace-nowrap text-muted">{member.xpTotal.toLocaleString("fr-FR")} XP</span>
                </li>)}
              </ol>
            </div>}
            {team.sessions.length > 0 && <div className="grid gap-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">Séances GameNight accessibles</p>
              {team.sessions.map((session) => <Link key={session.id} href={`/sessions/${session.id}`} className="text-sm text-accent hover:underline">
                {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(session.date)} · {session.decidedGame?.name ?? "Vote en cours"}
              </Link>)}
            </div>}
            {isLeader ? <form action={setCommunityTeamRecruitmentAction}>
              <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="open" value={String(!team.isRecruiting)} />
              <Button type="submit" size="sm">{team.isRecruiting ? "Fermer le recrutement" : "Rouvrir le recrutement"}</Button>
            </form> : isMember ? <form action={leaveCommunityTeamAction}>
              <input type="hidden" name="teamId" value={team.id} /><Button type="submit" size="sm">Quitter l’équipe</Button>
            </form> : team.isRecruiting && team._count.members < team.maxMembers ? <form action={joinCommunityTeamAction}>
              <input type="hidden" name="teamId" value={team.id} /><Button type="submit" size="sm" variant="primary">Rejoindre l’équipe</Button>
            </form> : null}
          </Card>;
        })}
      </section>
    </main>
  );
}
