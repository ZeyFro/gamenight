import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import {
  getActiveCommunityState,
  isCommunityPickerEnabled,
  listPickableCommunities,
  safeNextPath,
} from "@/lib/community-picker";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { selectCommunityAction } from "./actions";

export const metadata = pageMetadata("Serveurs");

/**
 * Sélecteur de serveur (drapeau COMMUNITY_PICKER_ENABLED, éteint = 404).
 * 0 serveur : message ; 1 serveur : redirection ; plusieurs : choix. Seuls les
 * serveurs où l'utilisateur est membre ACTIF sont listés.
 */
export default async function ServeursPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isCommunityPickerEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { next } = await searchParams;
  const nextPath = safeNextPath(next);
  const state = await getActiveCommunityState(user.id);

  if (state.kind === "single") redirect(nextPath);

  if (state.kind !== "chosen" && state.kind !== "needs-choice") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <EmptyState
          icon="🤖"
          title="Le bot n'est sur aucun de tes serveurs"
          action={
            <p className="max-w-sm text-sm text-muted">
              Dès que le bot est présent sur un serveur Discord dont tu es membre, il apparaît ici.
            </p>
          }
        />
      </div>
    );
  }

  const communities = await listPickableCommunities(user.id);
  const currentId = state.kind === "chosen" ? state.communityId : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Choisis ton serveur</h1>
        <p className="mt-1 text-sm text-muted">
          Tu es membre de plusieurs serveurs : GameNight affiche celui que tu choisis.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {communities.map((c) => (
          <li key={c.id}>
            <Card className="flex items-center justify-between gap-4 !p-4 sm:!p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 font-semibold text-accent"
                  aria-hidden
                >
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  {c.id === currentId && <p className="text-xs text-muted">Serveur actuel</p>}
                </div>
              </div>
              <form action={selectCommunityAction}>
                <input type="hidden" name="communityId" value={c.id} />
                <input type="hidden" name="next" value={nextPath} />
                <Button type="submit" size="sm" variant={c.id === currentId ? "secondary" : "primary"}>
                  {c.id === currentId ? "Rester ici" : "Choisir"}
                </Button>
              </form>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
