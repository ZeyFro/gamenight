import { listLegacyPublicSessionAnnounces } from "@/lib/legacy-discord-announces";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const ROLE_LABELS: Record<string, string> = {
  announce: "Annonce",
  thread: "Fil",
  "thread-summary": "Résumé de fil",
};

function roleLabel(role: string): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role];
  if (role.startsWith("thread-reminder-")) return `Rappel (${role.slice("thread-reminder-".length)} min)`;
  return role;
}

/**
 * Onglet "Confidentialité" du hub /admin — inventaire EN LECTURE SEULE
 * des annonces/fils Discord PUBLICS déjà envoyés avant ce chantier (voir
 * src/lib/legacy-discord-announces.ts pour la portée et les limites
 * exactes). AUCUN bouton d'action ici — ni suppression, ni modification,
 * ni renvoi : ce chantier prépare le terrain pour une décision humaine
 * ultérieure, il ne l'exécute jamais lui-même.
 */
export async function ConfidentialiteTab({ userId }: { userId: string }) {
  const { entries, sessionCount } = await listLegacyPublicSessionAnnounces({ userId });

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold text-foreground">Anciennes annonces Discord publiques</h2>
        <p className="text-sm text-muted">
          Ces messages/fils ont été envoyés dans le salon PUBLIC configuré
          (chemin bot, avant l&apos;activation de la confidentialité des
          soirées) — ils resteront visibles publiquement tant qu&apos;une
          opération spécifique (hors de ce chantier) ne les aura pas
          traités. Aucune suppression ni modification automatique n&apos;a
          eu lieu ni n&apos;aura lieu depuis cette page.
        </p>
        <p className="text-xs text-muted">
          Limite connue : cet inventaire ne couvre QUE le chemin bot (tracé
          en base). Les annonces envoyées via l&apos;ancien webhook
          (<code>DISCORD_WEBHOOK_URL</code>) ne laissent aucune trace ici —
          leur revue reste entièrement manuelle, directement dans Discord.
        </p>
      </Card>

      <p className="text-sm text-muted">
        {entries.length} entrée{entries.length === 1 ? "" : "s"} sur {sessionCount} soirée
        {sessionCount === 1 ? "" : "s"}.
      </p>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucune annonce publique connue en base (chemin bot) — soit
            aucune soirée bot n&apos;a jamais été annoncée avant ce
            chantier, soit cet inventaire a déjà été consulté après que de
            nouvelles soirées (désormais privées) ont été créées.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <Card key={entry.deliveryId} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{roleLabel(entry.role)}</Badge>
                <span className="text-muted">{entry.operation}</span>
                {entry.sentAt && <span className="text-muted">{formatDateTimeFr(entry.sentAt)}</span>}
              </div>
              <p className="text-foreground">
                Soirée {entry.sessionId}
                {entry.sessionStatus ? ` — ${entry.sessionStatus}` : " — supprimée depuis"}
                {entry.sessionDate ? ` — ${formatDateTimeFr(entry.sessionDate)}` : ""}
              </p>
              <p className="text-xs text-muted">
                salon {entry.discordChannelId ?? "?"}
                {entry.discordThreadId ? ` · fil ${entry.discordThreadId}` : ""}
                {entry.discordMessageId ? ` · message ${entry.discordMessageId}` : ""}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
