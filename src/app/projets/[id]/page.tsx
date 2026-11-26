import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getProject, getProjectsCommunityId } from "@/lib/projects";
import { projectOrganizerEnabled } from "@/lib/projects-rules";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";
import { applyToProjectAction, closeProjectAction, decideProjectEntryAction, renewProjectAction, withdrawFromProjectAction } from "../actions";

export const metadata = pageMetadata("Projet");

const RESULTS: Record<string, string> = {
  created: "Projet créé.", applied: "Ta candidature est envoyée à l'organisateur.", withdrawn: "Tu t'es retiré du projet.",
  accepted: "Entrée validée.", declined: "Entrée refusée.", closed: "Projet clôturé.", renewed: "Projet renouvelé.",
  pending: "Tu as déjà une candidature en attente.", member: "Tu participes déjà.", declined_final: "Ta candidature a été refusée.",
  own: "Tu es l'organisateur de ce projet.", full: "Le projet est complet.", forbidden: "Seul l'organisateur peut décider.",
  not_pending: "Cette candidature a déjà été traitée.", rate: "Trop de demandes, réessaie dans une minute.", invalid: "Message trop long (300 caractères maximum).",
};

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ result?: string }> }) {
  if (!projectOrganizerEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getProjectsCommunityId(user.id);
  if (!communityId) notFound();
  const [{ id }, { result }] = await Promise.all([params, searchParams]);
  const project = await getProject(user.id, communityId, id);
  if (!project) notFound();
  const open = project.status === "OPEN";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <Link href="/projets" className="text-sm text-accent underline-offset-4 hover:underline">← Projets</Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{project.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Organisé par {project.organizerName}{project.gameName ? ` · ${project.gameName}` : ""} · fin {formatDateTimeFr(project.endsAt)}
          {!open ? " · clôturé" : ""}
        </p>
      </header>
      {result && RESULTS[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p>}
      <Card><p className="whitespace-pre-wrap text-sm text-foreground">{project.description}</p></Card>

      <Card className="grid gap-2">
        <h2 className="font-semibold text-foreground">Participants ({project.participants.length}{project.maxEntries ? `/${project.maxEntries}` : ""})</h2>
        <p className="text-sm text-muted">{project.participants.map((participant) => participant.name).join(", ") || "Aucun participant validé pour l'instant."}</p>
      </Card>

      {!project.isOrganizer && open && (
        <Card>
          {project.myEntry === null && (
            <form action={applyToProjectAction} className="grid gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <label className="grid gap-1 text-sm text-foreground">Un mot pour l&apos;organisateur (facultatif)
                <textarea name="message" maxLength={300} rows={2} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
              </label>
              <Button type="submit" variant="primary" fullWidthOnMobile>Demander à participer</Button>
            </form>
          )}
          {project.myEntry !== null && (
            <form action={withdrawFromProjectAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="projectId" value={project.id} />
              <span className="text-sm text-muted">{project.myEntry === "PENDING" ? "Candidature en attente de validation." : "Tu participes à ce projet."}</span>
              <Button type="submit" variant="secondary" size="sm">{project.myEntry === "PENDING" ? "Retirer ma candidature" : "Quitter le projet"}</Button>
            </form>
          )}
        </Card>
      )}

      {project.isOrganizer && (
        <>
          <Card className="grid gap-3">
            <h2 className="font-semibold text-foreground">Candidatures ({project.pending.length})</h2>
            {project.pending.length === 0 && <p className="text-sm text-muted">Aucune candidature en attente.</p>}
            {project.pending.map((entry) => (
              <div key={entry.id} className="grid gap-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">{entry.name}</p>
                {entry.message && <p className="whitespace-pre-wrap text-sm text-muted">{entry.message}</p>}
                <div className="flex gap-2">
                  {(["ACCEPT", "DECLINE"] as const).map((decision) => (
                    <form key={decision} action={decideProjectEntryAction}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <input type="hidden" name="decision" value={decision} />
                      <Button type="submit" variant={decision === "ACCEPT" ? "secondary" : "destructive"} size="sm">{decision === "ACCEPT" ? "Valider" : "Refuser"}</Button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </Card>
          {open && (
            <form action={renewProjectAction} className="grid gap-2 rounded-lg border border-border p-3">
              <input type="hidden" name="projectId" value={project.id} />
              <p className="text-sm text-muted">Renouveler la date de fin (90 jours maximum à partir d’aujourd’hui).</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm text-foreground">Nouvelle date
                  <input type="date" name="endDate" required className="rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground" />
                </label>
                <label className="grid gap-1 text-sm text-foreground">Heure
                  <input type="time" name="endTime" defaultValue="23:59" className="rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground" />
                </label>
                <Button type="submit" variant="secondary" size="sm">Renouveler</Button>
              </div>
            </form>
          )}
          {open && (
            <form action={closeProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="destructive" size="sm">Clôturer le projet maintenant</Button>
              <p className="mt-1 text-xs text-muted">Les fils Discord sont archivés 7 jours après la clôture.</p>
            </form>
          )}
        </>
      )}
    </main>
  );
}
