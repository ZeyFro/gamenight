import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { listAllInvites } from "@/lib/session-access";
import { getSessionInviteSyncStatuses, getSessionThreadReadiness, type SessionThreadReadiness } from "@/lib/session-announce";
import { isSessionAnnounceViaBotEnabled } from "@/lib/discord-bot-config";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import {
  addSessionInviteAction,
  revokeSessionInviteAction,
  retrySessionInviteSyncAction,
  retrySessionCreatorThreadSyncAction,
  resyncSessionThreadMembersAction,
} from "../../actions/invites";

/**
 * Bug remonté en test réel : le créateur pouvait voir le fil Discord
 * listé (ex. "Plus de fils actifs", un effet de bord des permissions de
 * modération de SON compte sur le serveur, sans rapport avec cette app)
 * sans jamais y être RÉELLEMENT ajouté comme membre — `resolveInviteSync`
 * n'ajoutait que les invités (`SessionInvite`), jamais le créateur
 * lui-même (voir `getSessionThreadReadiness`, session-announce.ts). Ces
 * libellés distinguent quatre états honnêtes, jamais un simple "prêt" par
 * optimisme.
 */
const THREAD_READINESS_LABELS: Record<
  SessionThreadReadiness,
  { text: string; tone: "accent" | "warning" | "neutral" }
> = {
  preparing: { text: "⏳ Préparation du fil Discord en cours (pas encore créé)", tone: "neutral" },
  syncing: { text: "⏳ Fil créé — ton ajout comme membre est en cours de synchronisation", tone: "neutral" },
  ready: { text: "✓ Fil Discord prêt — tu y as accès", tone: "accent" },
  failed: { text: "⚠️ Échec de préparation du fil ou de ton ajout — réessai manuel possible", tone: "warning" },
};

const SYNC_LABELS: Record<string, { text: string; tone: "accent" | "warning" | "neutral" }> = {
  synced: { text: "✓ Synchronisé sur Discord", tone: "accent" },
  pending: { text: "⏳ Synchronisation Discord en attente (prochain passage du cron)", tone: "neutral" },
  failed: { text: "⚠️ Échec de synchronisation Discord — accès applicatif déjà à jour, réessai manuel possible", tone: "warning" },
};

/**
 * Libellés dédiés au retrait — jamais les mêmes textes que `SYNC_LABELS`
 * (pensés pour un AJOUT) : ici "synced" signifie "retiré du fil Discord",
 * "failed" signifie que le retrait Discord a ÉCHOUÉ — le créateur ne doit
 * JAMAIS lire "accès coupé" tant que ce retrait n'est pas confirmé par
 * Discord (voir revue ciblée, chantier confidentialité des soirées) : sans
 * ce libellé distinct, un échec de retrait resterait invisible et
 * l'invité pourrait conserver un accès Discord que le créateur croit coupé.
 */
const REVOKE_SYNC_LABELS: Record<string, { text: string; tone: "accent" | "warning" | "neutral" }> = {
  synced: { text: "✓ Retiré du fil Discord", tone: "accent" },
  pending: { text: "⏳ Retrait Discord en attente (accès Discord pas encore coupé)", tone: "neutral" },
  failed: { text: "⚠️ Le retrait Discord a échoué — cette personne peut encore avoir accès au fil Discord", tone: "warning" },
};

/**
 * Gestion des invités — réservée au créateur. Distingue explicitement les
 * invités ACTIFS (accès courant) des invités RÉVOQUÉS (historique,
 * réinvitables en un clic) — jamais une simple liste plate qui perdrait
 * cette distinction.
 *
 * La synchronisation Discord n'est jamais présentée comme instantanée :
 * `getSessionInviteSyncStatuses` reflète l'état RÉEL de la dernière
 * livraison enqueue (PENDING/SENT/FAILED côté `NotificationDelivery`),
 * jamais un optimisme "ça vient de partir" — voir session-announce.ts.
 */
export default async function SessionInvitesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, date: true, createdById: true, announceViaBot: true },
  });
  // Page de gestion réservée au créateur — un invité (même actif) n'a pas
  // à savoir qui d'autre est invité, ni à modifier la liste (règle
  // produit explicite : "seul le créateur gère les invitations").
  if (!session || session.createdById !== user.id) notFound();

  const [invites, potes] = await Promise.all([
    listAllInvites(sessionId),
    prisma.user.findMany({
      where: { id: { not: user.id } },
      select: { id: true, discordName: true, discordAvatar: true, color: true },
      orderBy: { discordName: "asc" },
    }),
  ]);

  const activeInvites = invites.filter((i) => i.status === "ACTIVE");
  const revokedInvites = invites.filter((i) => i.status === "REVOKED");
  const invitedIds = new Set(invites.map((i) => i.userId));
  const notYetInvited = potes.filter((p) => !activeInvites.some((i) => i.userId === p.id));

  const syncStatuses = session.announceViaBot
    ? await getSessionInviteSyncStatuses(sessionId, invites.map((i) => i.id))
    : new Map<string, "synced" | "pending" | "failed">();

  const creatorThreadReadiness = session.announceViaBot ? await getSessionThreadReadiness(sessionId) : null;

  const botConfigured = isSessionAnnounceViaBotEnabled();

  // Bug remonté en revue — une soirée créée AVANT les correctifs
  // creator-member/enqueueSessionInviteSyncForNewInvite n'a la moindre
  // livraison enqueue-ée ni pour le créateur ni pour ses invités : le
  // statut affiché reste indéfiniment "en cours de synchronisation" sans
  // qu'aucun cron n'ait jamais rien à traiter, et les boutons "Réessayer"
  // individuels n'apparaissent que sur un échec explicite — jamais
  // atteint dans ce cas précis. Le bouton groupé ci-dessous reste offert
  // tant que TOUT n'est pas confirmé synchronisé — sans risque pour une
  // personne déjà membre (voir `resyncSessionThreadMembers`).
  const needsThreadResync =
    session.announceViaBot &&
    (creatorThreadReadiness !== "ready" ||
      activeInvites.some((i) => syncStatuses.get(i.id) !== "synced"));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href={`/sessions/${sessionId}`}
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Retour à la soirée
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
          👥 Invités — {formatDateTimeFr(session.date)}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Seuls toi et les invités actifs ci-dessous peuvent voir et rejoindre cette
          soirée (site et Discord).
        </p>
      </div>

      {session.announceViaBot && !botConfigured && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Le bot Discord n&apos;est plus configuré — les invitations/retraits restent
          appliqués côté site, mais leur synchronisation Discord (fil privé) est en
          attente jusqu&apos;à ce que la configuration soit restaurée.
        </p>
      )}

      {creatorThreadReadiness && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold text-foreground">Ton accès au fil Discord</h2>
          <p
            className={`text-sm ${
              THREAD_READINESS_LABELS[creatorThreadReadiness].tone === "warning"
                ? "text-warning"
                : THREAD_READINESS_LABELS[creatorThreadReadiness].tone === "accent"
                  ? "text-accent"
                  : "text-muted"
            }`}
          >
            {THREAD_READINESS_LABELS[creatorThreadReadiness].text}
          </p>
          {creatorThreadReadiness === "failed" && (
            <form action={retrySessionCreatorThreadSyncAction}>
              <input type="hidden" name="sessionId" value={sessionId} />
              <Button type="submit" variant="secondary" size="sm">
                Réessayer
              </Button>
            </form>
          )}
        </Card>
      )}

      {needsThreadResync && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold text-foreground">Réparer l&apos;accès au fil Discord</h2>
          <p className="text-sm text-muted">
            Toi et/ou certains invités actifs n&apos;êtes pas encore confirmés membres du
            fil privé. Si l&apos;attente se prolonge (soirée créée avant un correctif
            récent, jamais rattrapée automatiquement), relance une synchronisation
            manuelle — elle ne recrée jamais le fil, ne renvoie aucune annonce, et reste
            sans effet pour qui est déjà membre.
          </p>
          <form action={resyncSessionThreadMembersAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" variant="secondary" size="sm">
              Resynchroniser le fil
            </Button>
          </form>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">Invités actifs ({activeInvites.length})</h2>
        {activeInvites.length === 0 && (
          <p className="text-sm text-muted">Personne d&apos;invité pour l&apos;instant — tu es seul sur cette soirée.</p>
        )}
        <ul className="flex flex-col gap-2">
          {activeInvites.map((invite) => {
            const sync = session.announceViaBot ? syncStatuses.get(invite.id) : undefined;
            const syncLabel = sync ? SYNC_LABELS[sync] : null;
            return (
              <li key={invite.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar src={invite.user.discordAvatar} alt={invite.user.discordName} size={28} ringColor={invite.user.color} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{invite.user.discordName}</p>
                    {syncLabel && (
                      <p className={`text-xs ${syncLabel.tone === "warning" ? "text-warning" : syncLabel.tone === "accent" ? "text-accent" : "text-muted"}`}>
                        {syncLabel.text}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {sync === "failed" && (
                    <form action={retrySessionInviteSyncAction}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Réessayer
                      </Button>
                    </form>
                  )}
                  <form action={revokeSessionInviteAction}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="guestUserId" value={invite.userId} />
                    <Button type="submit" variant="destructive" size="sm">
                      Retirer
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {notYetInvited.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">Inviter</h2>
          <ul className="flex flex-col gap-2">
            {notYetInvited.map((pote) => (
              <li key={pote.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar src={pote.discordAvatar} alt={pote.discordName} size={28} ringColor={pote.color} />
                  <p className="truncate text-sm font-medium text-foreground">{pote.discordName}</p>
                  {invitedIds.has(pote.id) && (
                    <Badge tone="neutral">déjà invité puis retiré</Badge>
                  )}
                </div>
                <form action={addSessionInviteAction}>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="guestUserId" value={pote.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    {invitedIds.has(pote.id) ? "Réinviter" : "Inviter"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {revokedInvites.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">Historique des retraits</h2>
          <ul className="flex flex-col gap-3">
            {revokedInvites.map((invite) => {
              const sync = session.announceViaBot ? syncStatuses.get(invite.id) : undefined;
              const syncLabel = sync ? REVOKE_SYNC_LABELS[sync] : null;
              return (
                <li key={invite.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm text-muted">
                    <p>
                      {invite.user.discordName} — retiré
                      {invite.revokedAt ? ` le ${formatDateTimeFr(invite.revokedAt)}` : ""}. Ses messages et votes
                      déjà envoyés restent visibles aux autres invités.
                    </p>
                    {syncLabel && (
                      <p className={`mt-0.5 text-xs ${syncLabel.tone === "warning" ? "text-warning" : syncLabel.tone === "accent" ? "text-accent" : "text-muted"}`}>
                        {syncLabel.text}
                      </p>
                    )}
                  </div>
                  {sync === "failed" && (
                    <form action={retrySessionInviteSyncAction} className="shrink-0">
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Réessayer
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
