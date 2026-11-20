import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getProjectsCommunityId, listProjects } from "@/lib/projects";
import { projectOrganizerEnabled } from "@/lib/projects-rules";
import { formatDateTimeFr, toDateInputValue, todayDateOnly } from "@/lib/wallclock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { createProjectAction } from "./actions";

export const metadata = pageMetadata("Projets");

const RESULTS: Record<string, string> = {
  invalid: "Vérifie les champs : nom (3 à 80), description (10 à 1000), date de fin valide.",
  too_soon: "La date de fin doit être au moins une heure plus tard.",
  too_far: "La date de fin ne peut pas dépasser un an.",
  member_required: "Tu dois être membre actif de la communauté.",
  rate: "Trop de demandes, réessaie dans une minute.",
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  if (!projectOrganizerEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getProjectsCommunityId(user.id);
  if (!communityId) notFound();
  const [{ result }, projects] = await Promise.all([searchParams, listProjects(user.id, communityId)]);
  const min = toDateInputValue(todayDateOnly());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">🗂️ Projets</h1>
        <p className="mt-2 text-sm text-muted">Un organisateur valide chaque entrée. Chaque projet a une date de fin, un fil public et un espace privé pour les participants validés.</p>
      </header>
      {result && RESULTS[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p>}

      <section aria-labelledby="projets-liste" className="grid gap-3">
        <h2 id="projets-liste" className="font-semibold text-foreground">En cours</h2>
        {projects.length === 0 && <EmptyState icon="🗂️" title="Aucun projet pour le moment." />}
        {projects.map((project) => (
          <Card key={project.id} className="grid gap-1">
            <Link href={`/projets/${project.id}`} className="font-semibold text-accent underline-offset-4 hover:underline">{project.name}</Link>
            <p className="text-sm text-muted">
              Organisé par {project.organizerName}{project.gameName ? ` · ${project.gameName}` : ""} · {project.acceptedCount}{project.maxEntries ? `/${project.maxEntries}` : ""} participant(s) · fin {formatDateTimeFr(project.endsAt)}
              {project.status === "CLOSED" ? " · clôturé" : ""}
            </p>
            {project.myEntry === "PENDING" && <p className="text-xs text-muted">Ta candidature est en attente.</p>}
            {project.myEntry === "ACCEPTED" && <p className="text-xs text-accent">Tu participes.</p>}
          </Card>
        ))}
      </section>

      <Card>
        <form action={createProjectAction} className="grid gap-3">
          <h2 className="font-semibold text-foreground">Lancer un projet</h2>
          <label className="grid gap-1 text-sm text-foreground">Nom<input name="name" required minLength={3} maxLength={80} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <label className="grid gap-1 text-sm text-foreground">Description et objectif<textarea name="description" required minLength={10} maxLength={1000} rows={3} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <label className="grid gap-1 text-sm text-foreground">Jeu (facultatif)<input name="gameName" maxLength={80} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <label className="grid gap-1 text-sm text-foreground">Participants maximum (facultatif, 2 à 200)<input name="maxEntries" type="number" min={2} max={200} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm text-foreground">Date de fin<input name="endDate" type="date" required min={min} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
            <label className="grid gap-1 text-sm text-foreground">Heure<input name="endTime" type="time" defaultValue="23:59" className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
          </div>
          <Button type="submit" variant="primary" fullWidthOnMobile>Créer le projet</Button>
        </form>
      </Card>
    </main>
  );
}
