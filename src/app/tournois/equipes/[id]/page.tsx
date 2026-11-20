import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getTournamentTeamsCommunityId } from "@/lib/tournament-teams";
import { getTeamTournamentView, listCaptainedTeams, listInvitableTeams } from "@/lib/tournament-teams-read";
import { isTournamentScoresEnabled } from "@/lib/tournament-scores";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";
import { enterTeamAction, inviteTeamAction, launchTeamTournamentAction, leaveTeamAction, reportMatchAction, resolveMatchAction } from "../actions";

export const metadata = pageMetadata("Tournoi d’équipes");

const MESSAGES: Record<string, string> = {
  created: "Tournoi créé.", invalid: "Informations invalides.", rate: "Trop de demandes, réessaie dans une minute.", unavailable: "Fonction indisponible.",
  entry_registered: "Équipe inscrite.", entry_launched: "Dernière place prise : le tournoi est lancé.", entry_closed: "Les inscriptions sont fermées.", entry_locked: "L’échéance des inscriptions est passée.",
  entry_full: "Tournoi complet.", entry_already: "Cette équipe est déjà inscrite.", entry_not_invited: "Tournoi privé : il faut une invitation de l’organisateur.",
  entry_forbidden: "Seul le capitaine peut inscrire son équipe.", entry_too_small: "Une équipe sans membre actif ne peut pas jouer.", entry_missing: "Tournoi ou équipe introuvable.",
  leave_declined: "Invitation refusée.", leave_withdrawn: "Équipe retirée.", leave_closed: "Le tournoi est déjà lancé.", leave_forbidden: "Seul le capitaine peut retirer son équipe.", leave_missing: "Inscription introuvable.",
  invite_invited: "Invitation envoyée au capitaine par message privé.", invite_not_private: "Seul un tournoi privé fonctionne sur invitation.", invite_forbidden: "Seul l’organisateur invite.",
  invite_closed: "Le tournoi est lancé.", invite_already: "Cette équipe est déjà invitée ou inscrite.", invite_missing: "Tournoi ou équipe introuvable.",
  launch_launched: "Tournoi lancé.", launch_too_few: "Il faut au moins 2 équipes inscrites.", launch_closed: "Le tournoi est déjà lancé.", launch_forbidden: "Seul l’organisateur lance le tournoi.", launch_missing: "Tournoi introuvable.",
  report_confirmed: "Résultat confirmé par les deux capitaines.", report_waiting: "Ta déclaration est enregistrée : le capitaine adverse doit la confirmer.",
  report_disputed: "Désaccord : l’organisateur est prévenu et tranchera.", report_forbidden: "Seuls les deux capitaines du match déclarent le résultat.",
  report_already_reported: "Ta déclaration est verrouillée : tu as déjà déclaré ce résultat.", report_already_decided: "Ce match est déjà tranché.",
  report_not_ready: "Les deux équipes ne sont pas encore connues.", report_invalid_winner: "Gagnant invalide.", report_closed: "Le tournoi n’est pas en cours.", report_missing: "Match introuvable ou informations invalides.",
  resolve_resolved: "Match tranché.", resolve_forbidden: "Seuls l’organisateur et les administrateurs tranchent.", resolve_already_decided: "Ce match est déjà tranché.",
  resolve_inconsistent: "Le gagnant doit avoir le score le plus élevé.", resolve_invalid_winner: "Gagnant invalide.", resolve_not_ready: "Match pas encore jouable.", resolve_missing: "Match introuvable.",
};
const ENTRY_LABELS = { INVITED: "Invitée", REGISTERED: "Inscrite", DECLINED: "A refusé", WITHDRAWN: "Retirée" } as const;
const STATUS_LABELS = { REGISTRATION: "Inscriptions ouvertes", IN_PROGRESS: "En cours", DONE: "Terminé", CANCELLED: "Annulé" } as const;
const inputClass = "rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground";

export default async function TeamTournamentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTournamentTeamsCommunityId(user.id);
  if (!communityId) redirect("/tournois/equipes");
  const [{ id }, { result }] = await Promise.all([params, searchParams]);
  const view = await getTeamTournamentView(user.id, communityId, id);
  if (!view) notFound();
  const [captained, invitable] = await Promise.all([
    listCaptainedTeams(user.id, communityId),
    view.viewer.isOrganizer && view.settings.isPrivate && view.status === "REGISTRATION" ? listInvitableTeams(user.id, communityId) : Promise.resolve([]),
  ]);
  const registered = view.entries.filter(entry => entry.status === "REGISTERED");
  const entryByTeam = new Map(view.entries.map(entry => [entry.teamId, entry.status]));
  const showScores = isTournamentScoresEnabled();
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <Link href="/tournois/equipes" className="text-sm text-accent underline-offset-4 hover:underline">← Tournois d’équipes</Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{view.name}{view.settings.isPrivate ? " 🔒" : ""}</h1>
        <p className="mt-1 text-sm text-muted">{view.gameName} · {STATUS_LABELS[view.status]} · organisé par {view.organizerName} · {registered.length}/{view.settings.maxTeams} équipes{view.settings.registrationClosesAt && view.status === "REGISTRATION" ? ` · inscriptions jusqu’au ${dateFormat.format(view.settings.registrationClosesAt)}` : ""}</p>
      </header>
      {result && MESSAGES[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{MESSAGES[result]}</p>}

      <section aria-labelledby="tt-teams" className="grid gap-3">
        <h2 id="tt-teams" className="font-semibold text-foreground">Équipes</h2>
        {view.entries.length === 0 ? <p className="text-sm text-muted">Aucune équipe pour le moment.</p> : (
          <ul className="grid gap-2">{view.entries.map(entry => <li key={entry.teamId} className="flex items-center justify-between gap-3 text-sm text-foreground"><span>{entry.teamName}</span><span className="text-muted">{ENTRY_LABELS[entry.status]}</span></li>)}</ul>
        )}
        {view.status === "REGISTRATION" && captained.map(team => {
          const status = entryByTeam.get(team.id);
          const canEnter = status !== "REGISTERED" && (!view.settings.isPrivate || status === "INVITED");
          return <Card key={team.id} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Ton équipe : {team.name}</span>
            <div className="flex gap-2">
              {canEnter && <form action={enterTeamAction}><input type="hidden" name="tournamentId" value={view.id} /><input type="hidden" name="teamId" value={team.id} /><Button type="submit" size="sm" variant="primary">{status === "INVITED" ? "Accepter l’invitation" : "Inscrire l’équipe"}</Button></form>}
              {(status === "INVITED" || status === "REGISTERED") && <form action={leaveTeamAction}><input type="hidden" name="tournamentId" value={view.id} /><input type="hidden" name="teamId" value={team.id} /><Button type="submit" size="sm">{status === "INVITED" ? "Refuser" : "Retirer l’équipe"}</Button></form>}
            </div>
          </Card>;
        })}
      </section>

      {view.viewer.isOrganizer && view.status === "REGISTRATION" && <section aria-labelledby="tt-org" className="grid gap-3">
        <h2 id="tt-org" className="font-semibold text-foreground">Organisation</h2>
        {view.settings.isPrivate && <form action={inviteTeamAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tournamentId" value={view.id} />
          <label className="grid gap-1 text-sm">Inviter une équipe
            <select name="teamId" required className={inputClass}><option value="">Choisir une équipe</option>{invitable.filter(team => !entryByTeam.has(team.id) || entryByTeam.get(team.id) === "DECLINED" || entryByTeam.get(team.id) === "WITHDRAWN").map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
          </label>
          <Button type="submit" size="sm">Inviter</Button>
        </form>}
        <form action={launchTeamTournamentAction}><input type="hidden" name="tournamentId" value={view.id} /><Button type="submit" size="sm" variant="primary">Lancer maintenant (au moins 2 équipes)</Button></form>
      </section>}

      {view.matches.length > 0 && <section aria-labelledby="tt-matches" className="grid gap-3">
        <h2 id="tt-matches" className="font-semibold text-foreground">Matchs</h2>
        {view.matches.filter(match => match.team1Id || match.team2Id).map(match => {
          const ownTeamId = [match.team1Id, match.team2Id].find(teamId => teamId && view.viewer.captainBracketTeamIds.includes(teamId)) ?? null;
          const ownReport = ownTeamId ? match.reports.find(report => report.teamId === ownTeamId) : undefined;
          const disputed = match.reports.length === 2 && match.reports[0].winnerTeamId !== match.reports[1].winnerTeamId;
          const ready = Boolean(match.team1Id && match.team2Id) && !match.completedAt && view.status === "IN_PROGRESS";
          const winnerName = match.winnerTeamId === match.team1Id ? match.team1?.name : match.winnerTeamId === match.team2Id ? match.team2?.name : null;
          const picker = (kind: "report" | "resolve") => <form action={kind === "report" ? reportMatchAction : resolveMatchAction} className="grid gap-2">
            <input type="hidden" name="tournamentId" value={view.id} /><input type="hidden" name="matchId" value={match.id} />
            <select name="winnerTeamId" required aria-label="Équipe gagnante" className={inputClass}><option value="">Équipe gagnante</option>
              <option value={match.team1Id ?? ""}>{match.team1?.name}</option><option value={match.team2Id ?? ""}>{match.team2?.name}</option></select>
            {showScores && <div className="grid grid-cols-2 gap-2"><input name="score1" type="number" min={0} max={999} aria-label={`Score ${match.team1?.name}`} placeholder="Score 1" className={inputClass} /><input name="score2" type="number" min={0} max={999} aria-label={`Score ${match.team2?.name}`} placeholder="Score 2" className={inputClass} /></div>}
            <Button type="submit" size="sm" variant={kind === "report" ? "primary" : undefined}>{kind === "report" ? "Déclarer le résultat" : "Trancher (organisateur)"}</Button>
          </form>;
          return <Card key={match.id} className="grid gap-2">
            <p className="text-sm font-semibold text-foreground">Tour {match.round} · {match.team1?.name ?? "À déterminer"} contre {match.team2?.name ?? "À déterminer"}</p>
            {match.completedAt ? <p className="text-sm text-muted">Vainqueur : {winnerName ?? "—"}{showScores && match.score1 !== null && match.score2 !== null ? ` (${match.score1} – ${match.score2})` : ""}</p>
              : <p className="text-xs text-muted">{match.reports.length === 0 ? "Aucune déclaration." : disputed ? "Désaccord entre les capitaines : l’organisateur tranche." : "Une déclaration reçue, en attente de confirmation de l’autre capitaine."}</p>}
            {ready && ownTeamId && (ownReport ? <p className="text-xs text-muted">Ta déclaration est verrouillée.</p> : picker("report"))}
            {ready && view.viewer.isReferee && match.reports.length > 0 && picker("resolve")}
          </Card>;
        })}
      </section>}
    </main>
  );
}
