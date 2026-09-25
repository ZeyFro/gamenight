import { generateStorageAuditReport } from "@/lib/storage-audit";
import { listFailedDiscordCleanupDeliveries } from "@/lib/discord-cleanup-status";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { retryDiscordCleanupAction } from "@/app/admin/nettoyage/actions";

const ROLE_LABELS: Record<string, string> = {
  "thread-delete": "Suppression du fil",
  "announce-delete": "Suppression de l'annonce",
};

/**
 * Onglet "Nettoyage" du hub /admin (chantier nettoyage réel du stockage,
 * V2) — trois sections EN LECTURE SEULE (le seul bouton actif est le
 * réessai d'un nettoyage Discord déjà en échec terminal, ci-dessous) :
 * inventaire du stockage, nettoyages Discord en échec, rappel de la
 * configuration du cron. AUCUNE suppression n'est jamais déclenchée depuis
 * cette page elle-même — le cron réel reste désactivé par défaut
 * (`RETENTION_CLEANUP_ENABLED`), voir le README pour la procédure
 * complète.
 */
export async function NettoyageTab() {
  const [audit, failedCleanups] = await Promise.all([
    generateStorageAuditReport(),
    listFailedDiscordCleanupDeliveries(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold text-foreground">Configuration du nettoyage automatique</h2>
        <p className="text-sm text-muted">
          Désactivé par défaut. Activation en deux temps : <code>RETENTION_CLEANUP_ENABLED=true</code>{" "}
          (le cron répond, mais reste en dry-run tant que le second réglage n&apos;est pas posé), puis{" "}
          <code>RETENTION_CLEANUP_MODE=execute</code> pour des mutations réelles. Voir le README pour la
          procédure complète et les commandes de vérification du dry-run.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">Inventaire du stockage (lecture seule)</h2>
        <p className="text-xs text-muted">
          Généré {new Date(audit.generatedAt).toLocaleString("fr-FR")} — sans accès aux données de
          production, ces chiffres ne reflètent que CETTE base, pas des volumes réels.
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <AuditRow label="Notifications" value={`${audit.notifications.total} (${audit.notifications.read} lues)`} />
          <AuditRow
            label="→ éligibles purge saison"
            value={audit.notifications.eligibleForPurge === null ? "aucune saison active" : String(audit.notifications.eligibleForPurge)}
          />
          <AuditRow label="Livraisons techniques" value={String(audit.notificationDelivery.total)} />
          <AuditRow label="→ terminales retry-safe" value={String(audit.notificationDelivery.terminalRetrySafe)} />
          <AuditRow label="Messages de chat" value={String(audit.chatMessages.total)} />
          <AuditRow label="→ éligibles purge (7j)" value={String(audit.chatMessages.eligibleForPurge)} />
          <AuditRow label="Soirées (total / actives)" value={`${audit.sessions.total} / ${audit.sessions.active}`} />
          <AuditRow
            label="→ éligibles / sans date fiable"
            value={`${audit.sessions.eligibleForPurge} / ${audit.sessions.noReliableDate}`}
          />
          <AuditRow
            label="→ bloquées (vote en attente / dette impayée)"
            value={`${audit.sessions.blockedBySuperlativeVoting} / ${audit.sessions.blockedByUnpaidDebt}`}
          />
          <AuditRow label="Tournois (total / actifs)" value={`${audit.tournaments.total} / ${audit.tournaments.active}`} />
          <AuditRow
            label="→ éligibles / sans date fiable"
            value={`${audit.tournaments.eligibleForPurge} / ${audit.tournaments.noReliableDate}`}
          />
          <AuditRow
            label="Jouer maintenant (total / actives)"
            value={`${audit.instantSessions.total} / ${audit.instantSessions.active}`}
          />
          <AuditRow
            label="→ éligibles / sans date fiable"
            value={`${audit.instantSessions.eligibleForPurge} / ${audit.instantSessions.noReliableDate}`}
          />
          <AuditRow label="Résultats de soirée" value={String(audit.sessionResults.total)} />
          <AuditRow
            label="Propositions / votes"
            value={`${audit.proposalsAndVotes.proposals} / ${audit.proposalsAndVotes.votes}`}
          />
          <AuditRow label="Matchs de tournoi" value={String(audit.tournamentMatches.total)} />
          <AuditRow
            label="XP / badges / snapshots"
            value={`${audit.xpAndRewards.xpEvents} / ${audit.xpAndRewards.userBadges} / ${audit.xpAndRewards.seasonSnapshots}`}
          />
        </dl>
        <p className="text-xs text-muted">{audit.scopeNote}</p>
        <p className="text-xs text-muted">{audit.attachments.note}</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">Nettoyages Discord en échec ({failedCleanups.length})</h2>
        <p className="text-sm text-muted">
          Suppressions définitives (fil ou annonce) d&apos;une soirée/d&apos;un tournoi déjà supprimé,
          restées en échec — l&apos;entité n&apos;apparaît plus dans aucune liste normale du site, ce
          tableau reste le seul endroit où ce nettoyage est visible et réessayable.
        </p>
        {failedCleanups.length === 0 ? (
          <p className="text-sm text-muted">Aucun nettoyage en échec connu.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {failedCleanups.map((entry) => (
              <div
                key={entry.deliveryId}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning">{ROLE_LABELS[entry.role] ?? entry.role}</Badge>
                    <span className="text-muted">
                      {entry.category === "SESSION" ? "Soirée" : "Tournoi"} {entry.sourceId}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {entry.attempts} tentative{entry.attempts === 1 ? "" : "s"} — {entry.errorClass ?? "erreur inconnue"}
                    {entry.lastError ? ` — ${entry.lastError}` : ""}
                  </p>
                </div>
                <form action={retryDiscordCleanupAction}>
                  <input type="hidden" name="category" value={entry.category} />
                  <input type="hidden" name="sourceId" value={entry.sourceId} />
                  <input type="hidden" name="role" value={entry.role} />
                  <Button type="submit" variant="secondary" size="sm">
                    Réessayer
                  </Button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AuditRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
