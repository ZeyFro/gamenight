import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/current-user";
import { listCommunityQuickPolls } from "@/lib/community-quick-polls";
import { isCommunityQuickPollsEnabled } from "@/lib/community-quick-polls-input";
import { pageMetadata } from "@/lib/page-title";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { formatDateTimeFr } from "@/lib/wallclock";
import { createCommunityQuickPollAction, voteCommunityQuickPollAction } from "./actions";

export const metadata = pageMetadata("Sondages éclair");
const PATH = "/profil/lore/sondages";
const MESSAGES: Record<string, string> = {
  saved: "Enregistré.", invalid: "Vérifie la question, les 2 à 6 réponses distinctes et la durée de 1 minute à 7 jours.",
  closed: "Ce sondage est clos. Ton vote n’a pas été modifié.",
  unavailable: "Ce sondage ou ce serveur n’est plus accessible avec tes droits actuels. Actualise la page.", rate: RATE_LIMIT_MESSAGE,
};

export default async function CommunityQuickPollsPage({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  if (!isCommunityQuickPollsEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const query = await searchParams;
  const page = /^\d+$/.test(query.page ?? "") ? Math.min(10000, Math.max(1, Number(query.page))) : 1;
  const collection = await listCommunityQuickPolls(user.id, page);
  const message = MESSAGES[query.result ?? ""];
  return (
    <div className="flex flex-col gap-4">
      <Link href="/profil/lore" className="min-h-11 self-start text-sm text-accent hover:underline">← Retour au Lore du groupe</Link>
      <header><h2 className="text-lg font-semibold text-foreground">Sondages éclair</h2>{collection && <p className="mt-1 text-sm text-muted">Serveur : {collection.community.name}</p>}</header>
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
      {!collection ? (
        <Card><p className="text-sm text-muted">Choisis une communauté dont tu es membre actif.</p><Link href="/serveurs" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Choisir un serveur</Link></Card>
      ) : (
        <>
          <Card>
            <h3 className="mb-3 font-semibold">Poser une question au serveur</h3>
            <form action={createCommunityQuickPollAction} className="flex flex-col gap-2">
              <input type="hidden" name="communityId" value={collection.community.id} /><input type="hidden" name="creationKey" value={randomUUID()} />
              <label htmlFor="quick-question" className="text-sm font-medium">Question (200 caractères maximum)</label>
              <input id="quick-question" name="question" required maxLength={200} className="rounded-lg border border-border bg-background p-3 text-sm" />
              <label htmlFor="quick-options" className="text-sm font-medium">2 à 6 réponses distinctes, une par ligne (80 caractères chacune)</label>
              <textarea id="quick-options" name="options" required maxLength={485} rows={4} className="rounded-lg border border-border bg-background p-3 text-sm" />
              <label htmlFor="quick-duration" className="text-sm font-medium">Durée en minutes (1 à 10 080, soit 7 jours)</label>
              <input id="quick-duration" name="durationMinutes" type="number" required min={1} max={10080} step={1} defaultValue={60} className="rounded-lg border border-border bg-background p-3 text-sm" />
              <p className="text-xs text-muted">Question et réponses restent fixes. Chacun dispose d’un seul choix, modifiable jusqu’à la fin. Les comptes sont visibles immédiatement ; les noms des votants ne sont pas affichés.</p>
              <Button type="submit" size="sm" className="mt-2 self-start">Créer le sondage</Button>
            </form>
          </Card>
          {collection.polls.length === 0 && <p className="text-sm text-muted">Aucun sondage sur cette page.</p>}
          <ul className="flex flex-col gap-3">
            {collection.polls.map(poll => {
              const total = poll.results.reduce((sum, row) => sum + row.count, 0);
              return (
                <li key={poll.id}>
                  <Card className="flex flex-col gap-3">
                    <h3 className="break-words font-semibold">{poll.question}</h3>
                    <p className="text-xs text-muted">{poll.closed ? "Clos" : "Ouvert"} · Fin : {formatDateTimeFr(poll.endsAt)} · {total} vote{total === 1 ? "" : "s"}</p>
                    <form key={`${poll.id}-${poll.selectedOption}-${poll.closed}`} action={voteCommunityQuickPollAction} className="flex flex-col gap-3">
                      <input type="hidden" name="communityId" value={collection.community.id} /><input type="hidden" name="pollId" value={poll.id} />
                      <fieldset disabled={poll.closed} className="flex flex-col gap-3">
                        <legend className="sr-only">{poll.question}</legend>
                        {poll.results.map((result, index) => (
                          <label key={index} className="flex min-h-11 flex-col gap-1 rounded-lg border border-border p-3">
                            <span className="flex items-center gap-2"><input type="radio" name="optionIndex" required value={index} defaultChecked={poll.selectedOption === index} /><span className="break-words text-sm">{result.label}</span><span className="ml-auto text-xs text-muted">{result.count}</span></span>
                            <progress value={result.count} max={Math.max(1, total)} aria-label={`Votes pour ${result.label}`} className="h-2 w-full" />
                          </label>
                        ))}
                      </fieldset>
                      {!poll.closed && <Button type="submit" size="sm" className="self-start">{poll.selectedOption === null ? "Voter" : "Modifier mon vote"}</Button>}
                    </form>
                  </Card>
                </li>
              );
            })}
          </ul>
          {(page > 1 || collection.hasNext) && <nav aria-label="Pages des sondages" className="flex flex-wrap gap-3">{page > 1 && <ButtonLink href={`${PATH}?page=${page - 1}`} size="sm">Précédents</ButtonLink>}{collection.hasNext && page < 10000 && <ButtonLink href={`${PATH}?page=${page + 1}`} size="sm">Suivants</ButtonLink>}</nav>}
        </>
      )}
    </div>
  );
}
