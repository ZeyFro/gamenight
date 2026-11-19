import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { listCommunityTeams } from "@/lib/community-teams";
import { getTeamApplicationsCommunityId, listMyTeamApplications, listPendingApplicationsForLeader } from "@/lib/team-applications";
import { TEAM_APPLICATION_MESSAGE_MAX } from "@/lib/team-applications-rules";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { listTeamRecruitmentCriteria } from "@/lib/team-recruitment-criteria";
import { TeamCriteriaSummary } from "../TeamCriteria";
import { applyToTeamAction, decideTeamApplicationAction, withdrawTeamApplicationAction } from "./actions";

export const metadata = pageMetadata("Candidatures d’équipe");

const RESULTS: Record<string, string> = {
  applied: "Ta candidature est envoyée au responsable.", accepted: "Candidature acceptée : le joueur a rejoint l’équipe.",
  declined: "Candidature refusée.", withdrawn: "Candidature retirée.", already_member: "Tu fais déjà partie de cette équipe.",
  already_team: "Ce joueur fait déjà partie d’une autre équipe : une seule équipe par joueur.", cooldown: "Ce joueur a quitté une équipe il y a moins de 7 jours : il doit attendre avant d’en rejoindre une autre.",
  pending: "Tu as déjà une candidature en attente pour cette équipe.", closed: "Le recrutement est fermé.", full: "Cette équipe est complète.",
  missing: "Candidature ou équipe introuvable.", forbidden: "Seul le responsable de l’équipe peut décider.",
  invalid: "Écris un message de 1 à 500 caractères.", rate: "Trop de demandes, réessaie dans une minute.",
  unavailable: "Les candidatures ne sont pas disponibles dans ta communauté.",
};
const STATUS_LABELS = { PENDING: "En attente", ACCEPTED: "Acceptée", DECLINED: "Refusée", WITHDRAWN: "Retirée" } as const;

export default async function TeamApplicationsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTeamApplicationsCommunityId(user.id);
  if (!communityId) {
    return <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8"><h1 className="text-2xl font-semibold">📨 Candidatures d’équipe</h1><Card className="text-sm text-muted">Les candidatures ne sont pas disponibles dans ta communauté.</Card><Link className="text-sm text-accent" href="/equipes">Voir les équipes →</Link></main>;
  }
  const [{ result }, teams, mine, received] = await Promise.all([
    searchParams,
    listCommunityTeams(user.id, communityId),
    listMyTeamApplications(user.id, communityId),
    listPendingApplicationsForLeader(user.id, communityId),
  ]);
  const pendingTeamIds = new Set(mine.filter(item => item.status === "PENDING").map(item => item.teamId));
  const openTeams = teams.filter(team => team.isRecruiting && team._count.members < team.maxMembers && !team.members.some(member => member.userId === user.id));
  const criteriaByTeam = await listTeamRecruitmentCriteria(user.id, communityId, openTeams.map((team) => team.id));
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <Link href="/equipes" className="text-sm text-accent underline-offset-4 hover:underline">← Équipes et aventures</Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">📨 Candidatures d’équipe</h1>
        <p className="mt-2 text-sm text-muted">Présente-toi au responsable d’une équipe qui recrute. Aucun ping ni message Discord n’est envoyé.</p>
      </header>
      {result && RESULTS[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p>}

      {received.length > 0 && <section aria-labelledby="received-title" className="grid gap-3">
        <h2 id="received-title" className="font-semibold text-foreground">Candidatures reçues ({received.length})</h2>
        {received.map(item => <Card key={item.id} className="grid gap-2">
          <p className="text-sm font-semibold text-foreground">{item.applicant.discordName} → {item.team.name}</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
          <p className="text-xs text-muted">{dateFormat.format(item.createdAt)}</p>
          <div className="flex flex-wrap gap-2">
            {(["accept", "decline"] as const).map(decision => <form key={decision} action={decideTeamApplicationAction}>
              <input type="hidden" name="applicationId" value={item.id} /><input type="hidden" name="decision" value={decision} />
              <Button type="submit" size="sm" variant={decision === "accept" ? "primary" : undefined}>{decision === "accept" ? "Accepter" : "Refuser"}</Button>
            </form>)}
          </div>
        </Card>)}
      </section>}

      <section aria-labelledby="open-title" className="grid gap-3">
        <h2 id="open-title" className="font-semibold text-foreground">Équipes qui recrutent ({openTeams.length})</h2>
        {openTeams.length === 0 ? <EmptyState icon="🧭" title="Aucune équipe ne recrute pour le moment." /> : openTeams.map(team => <Card key={team.id} className="grid gap-2">
          <div><p className="font-semibold text-foreground">{team.name}</p><p className="text-sm text-muted">{team.game.name} · {team.platform} · {team._count.members}/{team.maxMembers} joueurs</p></div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{team.description}</p>
          <TeamCriteriaSummary criteria={criteriaByTeam.get(team.id)} />
          {pendingTeamIds.has(team.id) ? <p className="text-xs text-muted">Candidature en attente.</p> : <form action={applyToTeamAction} className="grid gap-2">
            <input type="hidden" name="teamId" value={team.id} />
            <label className="grid gap-1 text-sm text-foreground">Ta candidature<textarea name="message" required maxLength={TEAM_APPLICATION_MESSAGE_MAX} rows={3} placeholder="Qui es-tu, à quoi joues-tu, quand es-tu disponible ?" className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
            <Button type="submit" size="sm" variant="primary">Postuler</Button>
          </form>}
        </Card>)}
      </section>

      <section aria-labelledby="mine-title" className="grid gap-3">
        <h2 id="mine-title" className="font-semibold text-foreground">Mes candidatures</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">Tu n’as encore postulé nulle part.</p> : mine.map(item => <Card key={item.id} className="grid gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-foreground">{item.team.name}</p><span className="text-xs text-muted">{STATUS_LABELS[item.status]} · {dateFormat.format(item.createdAt)}</span></div>
          <p className="whitespace-pre-wrap text-sm text-muted">{item.message}</p>
          {item.status === "PENDING" && <form action={withdrawTeamApplicationAction}><input type="hidden" name="applicationId" value={item.id} /><Button type="submit" size="sm">Retirer ma candidature</Button></form>}
        </Card>)}
      </section>
    </main>
  );
}
