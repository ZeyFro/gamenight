import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/current-user";
import { listCommunityExpressions } from "@/lib/community-expressions";
import { isCommunityExpressionsEnabled, MAX_EXPRESSION_MEANING_LENGTH, MAX_EXPRESSION_TITLE_LENGTH } from "@/lib/community-expressions-input";
import { pageMetadata } from "@/lib/page-title";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { deleteCommunityExpressionAction, saveCommunityExpressionAction } from "./actions";

export const metadata = pageMetadata("Expressions du serveur");

const MESSAGES: Record<string, string> = {
  saved: "Expression enregistrée.",
  deleted: "Expression supprimée.",
  invalid: "Renseigne une expression (120 caractères maximum) et son sens (2 000 caractères maximum).",
  unavailable: "Cette expression n’est pas accessible ou tu n’as plus le droit de la modifier.",
  rate: RATE_LIMIT_MESSAGE,
};

function ExpressionFields({ id, title = "", meaning = "" }: { id: string; title?: string; meaning?: string }) {
  return (
    <>
      <label htmlFor={`${id}-title`} className="text-sm font-medium">Expression ou running gag</label>
      <input id={`${id}-title`} name="title" required maxLength={MAX_EXPRESSION_TITLE_LENGTH} defaultValue={title} className="w-full rounded-lg border border-border bg-background p-3 text-base sm:text-sm" />
      <label htmlFor={`${id}-meaning`} className="text-sm font-medium">Sens et histoire</label>
      <textarea id={`${id}-meaning`} name="meaning" required maxLength={MAX_EXPRESSION_MEANING_LENGTH} rows={4} defaultValue={meaning} className="w-full rounded-lg border border-border bg-background p-3 text-base sm:text-sm" />
    </>
  );
}

export default async function CommunityExpressionsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  if (!isCommunityExpressionsEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const collection = await listCommunityExpressions(user.id);
  const canManage = collection?.role === "ADMIN" || collection?.role === "OWNER";
  const message = MESSAGES[(await searchParams).result ?? ""];
  return (
    <div className="flex flex-col gap-4">
      <Link href="/profil/lore" className="min-h-11 self-start text-sm text-accent hover:underline">← Retour au Lore du groupe</Link>
      <header>
        <h2 className="text-lg font-semibold text-foreground">Expressions et running gags</h2>
        {collection && <p className="mt-1 text-sm text-muted">Serveur : {collection.community.name}</p>}
      </header>
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
      {!collection ? (
        <Card><p className="text-sm text-muted">Choisis une communauté dont tu es membre actif pour consulter ses expressions.</p><Link href="/serveurs" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Choisir un serveur</Link></Card>
      ) : (
        <>
          {canManage && <Card>
            <h3 className="mb-3 font-semibold">Ajouter une expression</h3>
            <form action={saveCommunityExpressionAction} className="flex flex-col gap-2">
              <input type="hidden" name="communityId" value={collection.community.id} />
              <ExpressionFields id="new-expression" />
              <Button type="submit" size="sm" className="mt-2 self-start">Ajouter au serveur</Button>
            </form>
          </Card>}
          {collection.entries.length === 0 && <p className="text-sm text-muted">Aucune expression pour ce serveur.</p>}
          <ul className="flex flex-col gap-3">
            {collection.entries.map((entry) => {
              return (
                <li key={entry.id}>
                  <Card className="flex flex-col gap-3">
                    <h3 className="break-words font-semibold">{entry.title}</h3>
                    <p className="whitespace-pre-wrap break-words text-sm text-muted">{entry.meaning}</p>
                    {canManage && (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-accent">Modifier ou supprimer</summary>
                        <form action={saveCommunityExpressionAction} className="flex flex-col gap-2">
                          <input type="hidden" name="communityId" value={collection.community.id} />
                          <input type="hidden" name="id" value={entry.id} />
                          <ExpressionFields id={entry.id} title={entry.title} meaning={entry.meaning} />
                          <Button type="submit" size="sm" className="mt-2 self-start">Enregistrer</Button>
                        </form>
                        <form action={deleteCommunityExpressionAction} className="mt-3">
                          <input type="hidden" name="communityId" value={collection.community.id} />
                          <input type="hidden" name="id" value={entry.id} />
                          <Button type="submit" variant="destructive" size="sm">Supprimer cette expression</Button>
                        </form>
                      </details>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
