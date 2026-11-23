import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  cancelFriendRequestAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
} from "@/app/potes/friends-actions";
import { FRIEND_RELATION_LABELS, FRIEND_SEARCH_MAX_LENGTH, FRIEND_SEARCH_MIN_LENGTH } from "@/lib/friends-rules";
import type { FriendRequestRow, FriendSearchHit } from "@/lib/friends";

/**
 * Demandes d'ami (reçues, envoyées) et recherche par pseudo, sur `/potes` (POTES_FRIENDS_ENABLED). Composant
 * serveur : les boutons sont des formulaires vers les actions serveur, aucun identifiant du demandeur n'est envoyé.
 */
export function FriendsPanel({
  incoming,
  outgoing,
  query,
  hits,
}: {
  incoming: FriendRequestRow[];
  outgoing: FriendRequestRow[];
  query: string;
  hits: FriendSearchHit[] | null;
}) {
  return (
    <>
      {incoming.length > 0 && (
        <Card>
          <h2 className="font-semibold text-foreground">Demandes reçues</h2>
          <ul className="mt-3 grid gap-3" aria-label="Demandes d’ami reçues">
            {incoming.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Avatar src={request.avatar} alt="" size={32} />
                  <Link href={`/potes/${request.userId}`} className="font-medium hover:underline">{request.name}</Link>
                  <span className="text-muted">veut devenir ton ami</span>
                </span>
                <span className="flex gap-2">
                  <form action={respondFriendRequestAction}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <Button type="submit" size="sm">Accepter</Button>
                  </form>
                  <form action={respondFriendRequestAction}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <Button type="submit" size="sm" variant="secondary">Refuser</Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {outgoing.length > 0 && (
        <Card>
          <h2 className="font-semibold text-foreground">Demandes envoyées</h2>
          <ul className="mt-3 grid gap-3" aria-label="Demandes d’ami envoyées">
            {outgoing.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Avatar src={request.avatar} alt="" size={32} />
                  <span className="font-medium">{request.name}</span>
                  <span className="text-muted">en attente</span>
                </span>
                <form action={cancelFriendRequestAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <Button type="submit" size="sm" variant="secondary">Annuler</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="font-semibold text-foreground">Trouver un joueur</h2>
        <p className="mt-1 text-sm text-muted">Cherche un membre de ton serveur par pseudo pour lui demander d’être ton ami. Les profils masqués ne sont jamais trouvés.</p>
        <form action="/potes" method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">Pseudo
            <input
              type="search"
              name="q"
              defaultValue={query}
              minLength={FRIEND_SEARCH_MIN_LENGTH}
              maxLength={FRIEND_SEARCH_MAX_LENGTH}
              autoComplete="off"
              className="rounded-lg border border-border bg-background px-3 py-2 text-base"
            />
          </label>
          <Button type="submit" size="sm">Chercher</Button>
        </form>
        {hits !== null && (
          hits.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Aucun membre trouvé pour « {query} ».</p>
          ) : (
            <ul className="mt-3 grid gap-3" aria-label="Résultats de la recherche">
              {hits.map((hit) => (
                <li key={hit.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <Avatar src={hit.avatar} alt="" size={32} />
                    <Link href={`/potes/${hit.id}`} className="font-medium hover:underline">{hit.name}</Link>
                  </span>
                  {hit.relation === "none" ? (
                    <form action={sendFriendRequestAction}>
                      <input type="hidden" name="targetId" value={hit.id} />
                      <Button type="submit" size="sm">Demander en ami</Button>
                    </form>
                  ) : hit.relation === "pending_received" ? (
                    <span className="text-sm text-muted">{FRIEND_RELATION_LABELS.pending_received} : réponds dans « Demandes reçues »</span>
                  ) : (
                    <span className="text-sm text-muted">{FRIEND_RELATION_LABELS[hit.relation]}</span>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </Card>
    </>
  );
}
