import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getCommunityTeamsCommunityId, listCommunityTeams } from "@/lib/community-teams";
import { transferCommunityTeamCaptainAction, dissolveCommunityTeamAction, saveTeamRecruitmentCriteriaAction, setCommunityTeamIdentityAction } from "../actions";
import { TEAM_EMBLEMS, safeTeamColor } from "@/lib/team-identity";
import { listTeamRecruitmentCriteria } from "@/lib/team-recruitment-criteria";
import { isTeamRecruitmentCriteriaEnabled } from "@/lib/team-recruitment-criteria-rules";
import { TeamCriteriaForm } from "../TeamCriteria";
import { TeamBadge } from "../TeamBadge";
import { pageMetadata } from "@/lib/page-title";
import { isTeamRecruitersEnabled, MAX_TEAM_RECRUITERS } from "@/lib/team-recruiters-rules";
import { listGuestInviteOptions, listTeamGuests, listTeamRecruiters } from "@/lib/team-recruiters";
import { addTeamRecruiterAction, inviteTeamGuestAction, removeTeamRecruiterAction, revokeTeamGuestAction } from "../recruteurs/actions";

export const metadata = pageMetadata("Gérer mes équipes");

const RESULTS: Record<string, string> = {
  saved: "Critères de recrutement enregistrés.", cleared: "Critères de recrutement effacés.", forbidden: "Seul le responsable de l’équipe peut modifier ses critères.", missing: "Équipe introuvable.",
  rate: "Trop de demandes, réessaie dans une minute.", identity_saved: "Couleur et emblème enregistrés.",
  transferred: "Capitanat transmis.", dissolved: "Équipe dissoute, historique conservé.",
  active_challenges: "Impossible : un défi de cette équipe est encore en cours.",
  recruiter_added: "Recruteur nommé.", recruiter_removed: "Recruteur retiré.", recruiter_limit: `Deux recruteurs au plus par équipe.`,
  recruiter_already: "Ce membre est déjà recruteur.", recruiter_not_member: "Seul un membre actif de l’équipe peut être recruteur.",
  recruiter_self_leader: "Le capitaine décide déjà des candidatures.", recruiter_forbidden: "Seul le capitaine nomme les recruteurs.", recruiter_missing: "Équipe ou recruteur introuvable.",
  guest_invited: "Invitation envoyée : le joueur doit l’accepter.", guest_revoked: "Invitation retirée.", guest_forbidden: "Seul le capitaine invite.",
  guest_tournament_closed: "Ce tournoi n’accepte plus d’inscriptions.", guest_already_member: "Ce joueur fait déjà partie de ton équipe.", guest_not_active: "Ce joueur n’est pas un membre actif de la communauté.",
  guest_already_guest: "Ce joueur est déjà invité à ce tournoi.", guest_roster_full: "Effectif complet (8 joueurs, invités compris).", guest_missing: "Équipe, tournoi ou invitation introuvable.",
  invalid: "Action non autorisée ou informations invalides.", unavailable: "Fonctionnalité indisponible.",
};

export default async function CommunityTeamManagementPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getCommunityTeamsCommunityId(user.id);
  if (!communityId) redirect("/equipes");
  const [{ result }, teams] = await Promise.all([searchParams, listCommunityTeams(user.id, communityId)]);
  const captained = teams.filter(team => (team.captainId ?? team.createdById) === user.id);
  const recruitersOn = isTeamRecruitersEnabled();
  const extras = new Map(await Promise.all(captained.map(async team => [team.id, recruitersOn ? {
    recruiters: await listTeamRecruiters(user.id, communityId, team.id),
    guests: await listTeamGuests(user.id, communityId, team.id),
    options: await listGuestInviteOptions(user.id, communityId, team.id),
  } : null] as const)));
  const criteriaByTeam = await listTeamRecruitmentCriteria(user.id, communityId, captained.map(team => team.id));

  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">Gérer mes équipes</h1>
    {result && RESULTS[result] && <p role="status">{RESULTS[result]}</p>}
    <p className="text-sm text-muted">La passation conserve le créateur historique. Une dissolution libère les membres, mais conserve les preuves et bloque une nouvelle adhésion pendant sept jours.</p>
    {captained.length === 0 && <p>Tu n’es capitaine d’aucune équipe active.</p>}
    {captained.map(team => <section key={team.id} className="rounded-lg border border-border p-4">
      <h2 className="font-semibold"><TeamBadge color={team.color} emblem={team.emblem} />{team.name}</h2>
      {extras.get(team.id) && <RecruiterAndGuestSections teamId={team.id} members={team.members.filter(member => member.userId !== user.id)} extra={extras.get(team.id)!} />}
      <form action={setCommunityTeamIdentityAction} className="mt-4 grid gap-3 border-b border-border pb-4">
        <input type="hidden" name="teamId" value={team.id} />
        <h3 className="font-medium">Couleur et emblème</h3>
        <p className="text-sm text-muted">Affichés à côté du nom de l’équipe. Seul le capitaine les choisit.</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1">Couleur
            <input type="color" name="color" defaultValue={safeTeamColor(team.color) ?? "#6366f1"} className="h-11 w-20 rounded-lg border border-border bg-background p-1" />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="noColor" defaultChecked={!safeTeamColor(team.color)} /> Sans couleur</label>
          <label className="grid gap-1">Emblème
            <select name="emblem" defaultValue={team.emblem ?? ""} className="rounded-lg border border-border bg-background p-3">
              <option value="">Aucun</option>
              {TEAM_EMBLEMS.map(emblem => <option key={emblem} value={emblem}>{emblem}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Enregistrer</button>
      </form>
      {isTeamRecruitmentCriteriaEnabled() && <TeamCriteriaForm teamId={team.id} action={saveTeamRecruitmentCriteriaAction} criteria={criteriaByTeam.get(team.id)} />}
      <form action={transferCommunityTeamCaptainAction} className="mt-4 grid gap-3">
        <input type="hidden" name="teamId" value={team.id} />
        <label className="grid gap-1">Transmettre le capitanat
          <select name="successorId" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Choisir un membre actif</option>
            {team.members.filter(member => member.userId !== user.id).map(member =>
              <option key={member.userId} value={member.userId}>{member.user.discordName}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Transmettre</button>
      </form>
      <form action={dissolveCommunityTeamAction} className="mt-6 grid gap-3 border-t border-border pt-4">
        <input type="hidden" name="teamId" value={team.id} />
        <p className="text-sm">Dissoudre l’équipe : impossible tant qu’un défi est en cours. Les anciennes récompenses restent conservées.</p>
        <label className="grid gap-1">Pour confirmer, sélectionne Dissoudre
          <select name="confirm" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Ne rien faire</option>
            <option value="DISSOLVE">Dissoudre l’équipe</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Confirmer la dissolution</button>
      </form>
    </section>)}
    <Link href="/equipes" className="text-accent underline">Retour aux équipes</Link>
  </main>;
}

type Extra = {
  recruiters: Awaited<ReturnType<typeof listTeamRecruiters>>;
  guests: Awaited<ReturnType<typeof listTeamGuests>>;
  options: Awaited<ReturnType<typeof listGuestInviteOptions>>;
};

function RecruiterAndGuestSections({ teamId, members, extra }: { teamId: string; members: { userId: string; user: { discordName: string } }[]; extra: Extra }) {
  const recruiterIds = new Set(extra.recruiters.map(recruiter => recruiter.userId));
  const candidates = members.filter(member => !recruiterIds.has(member.userId));
  return <>
    <div className="mt-4 grid gap-3 border-b border-border pb-4">
      <h3 className="font-medium">Recruteurs ({extra.recruiters.length}/{MAX_TEAM_RECRUITERS})</h3>
      <p className="text-sm text-muted">Un recruteur accepte ou refuse les candidatures et reçoit, comme toi, les messages privés de candidature. Il n’a aucun autre pouvoir.</p>
      {extra.recruiters.map(recruiter => <form key={recruiter.userId} action={removeTeamRecruiterAction} className="flex items-center gap-3">
        <input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="userId" value={recruiter.userId} />
        <span>{recruiter.user.discordName}</span><button type="submit" className="rounded-lg border border-border px-3 py-1 text-sm">Retirer</button>
      </form>)}
      {extra.recruiters.length < MAX_TEAM_RECRUITERS && candidates.length > 0 && <form action={addTeamRecruiterAction} className="grid gap-2">
        <input type="hidden" name="teamId" value={teamId} />
        <label className="grid gap-1">Nommer un recruteur
          <select name="userId" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Choisir un membre actif</option>
            {candidates.map(member => <option key={member.userId} value={member.userId}>{member.user.discordName}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Nommer</button>
      </form>}
    </div>
    <div className="mt-4 grid gap-3 border-b border-border pb-4">
      <h3 className="font-medium">Invités de tournoi</h3>
      <p className="text-sm text-muted">Invite un joueur d’une autre équipe à jouer un tournoi pour la tienne. Il garde son équipe principale et doit accepter.</p>
      {extra.guests.map(guest => <form key={guest.id} action={revokeTeamGuestAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="guestId" value={guest.id} />
        <span>{guest.user.discordName} → {guest.tournament.name} ({guest.status === "ACCEPTED" ? "accepté" : "en attente"})</span>
        <button type="submit" className="rounded-lg border border-border px-3 py-1 text-sm">Retirer</button>
      </form>)}
      {extra.options.tournaments.length > 0 ? <form action={inviteTeamGuestAction} className="grid gap-2">
        <input type="hidden" name="teamId" value={teamId} />
        <label className="grid gap-1">Tournoi
          <select name="tournamentId" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Choisir un tournoi ouvert</option>
            {extra.options.tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Joueur invité
          <select name="userId" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Choisir un joueur</option>
            {extra.options.players.map(player => <option key={player.id} value={player.id}>{player.discordName}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Inviter</button>
      </form> : <p className="text-sm text-muted">Aucun tournoi ouvert aux inscriptions.</p>}
    </div>
  </>;
}
