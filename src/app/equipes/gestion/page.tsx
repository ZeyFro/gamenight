import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getCommunityTeamsCommunityId, listCommunityTeams } from "@/lib/community-teams";
import { transferCommunityTeamCaptainAction, dissolveCommunityTeamAction } from "../actions";

const RESULTS: Record<string, string> = {
  transferred: "Capitanat transmis.", dissolved: "Équipe dissoute, historique conservé.",
  active_challenges: "Impossible : un défi de cette équipe est encore en cours.",
  invalid: "Action non autorisée ou informations invalides.", unavailable: "Fonctionnalité indisponible.",
};

export default async function CommunityTeamManagementPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getCommunityTeamsCommunityId(user.id);
  if (!communityId) redirect("/equipes");
  const [{ result }, teams] = await Promise.all([searchParams, listCommunityTeams(user.id, communityId)]);
  const captained = teams.filter(team => (team.captainId ?? team.createdById) === user.id);

  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">Gérer mes équipes</h1>
    {result && RESULTS[result] && <p role="status">{RESULTS[result]}</p>}
    <p className="text-sm text-muted">La passation conserve le créateur historique. Une dissolution libère les membres, mais conserve les preuves et bloque une nouvelle adhésion pendant sept jours.</p>
    {captained.length === 0 && <p>Tu n'es capitaine d'aucune équipe active.</p>}
    {captained.map(team => <section key={team.id} className="rounded-lg border border-border p-4">
      <h2 className="font-semibold">{team.name}</h2>
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
        <p className="text-sm">Dissoudre l'équipe : impossible tant qu'un défi est en cours. Les anciennes récompenses restent conservées.</p>
        <label className="grid gap-1">Pour confirmer, sélectionne Dissoudre
          <select name="confirm" required className="rounded-lg border border-border bg-background p-3">
            <option value="">Ne rien faire</option>
            <option value="DISSOLVE">Dissoudre l'équipe</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2">Confirmer la dissolution</button>
      </form>
    </section>)}
    <Link href="/equipes" className="text-accent underline">Retour aux équipes</Link>
  </main>;
}
