import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { findActiveMembership } from "@/lib/community-access";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { saveFairPlayCharterAction } from "./actions";
import { MAX_FAIR_PLAY_CHARTER_LENGTH } from "@/lib/fair-play-charter";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Charte de fair-play");

export default async function FairPlayCharterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) redirect("/serveurs");
  const membership = await findActiveMembership(user.id, communityId);
  if (!membership) redirect("/serveurs");
  const { community } = membership;
  const canEdit = membership.role === "OWNER" || membership.role === "ADMIN";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Charte de fair-play</h1>
        <p className="mt-1 text-sm text-muted">{community.name}</p>
      </header>
      <Card className="flex flex-col gap-4">
        {community.fairPlayCharter ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{community.fairPlayCharter}</p>
        ) : (
          <p className="text-sm text-muted">Aucune charte n’a encore été publiée pour ce serveur.</p>
        )}
        {canEdit && (
          <form action={saveFairPlayCharterAction} className="flex flex-col gap-3 border-t border-border pt-4">
            <label htmlFor="charter" className="text-sm font-medium text-foreground">Modifier la charte</label>
            <textarea
              id="charter"
              name="charter"
              defaultValue={community.fairPlayCharter ?? ""}
              maxLength={MAX_FAIR_PLAY_CHARTER_LENGTH}
              rows={8}
              className="w-full rounded-lg border border-border bg-background p-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-describedby="charter-help"
            />
            <p id="charter-help" className="text-xs text-muted">Jusqu’à {MAX_FAIR_PLAY_CHARTER_LENGTH} caractères. Laisser vide pour retirer la charte.</p>
            <Button type="submit" className="self-start">Enregistrer</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
