import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatDateTimeFr } from "@/lib/wallclock";
import type { DiscoverableSession } from "@/lib/session-applications";
import {
  applyToSessionAction,
  joinPublicSessionAction,
  withdrawSessionApplicationAction,
} from "@/app/sessions/actions/visibility";

/**
 * Soirées ouvertes (publiques ou sur candidature) de ma communauté. Informations minimales,
 * jamais le contenu : l'accès à une soirée ne s'ouvre qu'après avoir rejoint ou été accepté.
 */
export function DiscoverableSessions({ sessions }: { sessions: DiscoverableSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby="soirees-ouvertes" className="flex flex-col gap-3">
      <h2 id="soirees-ouvertes" className="text-lg font-semibold text-foreground">Soirées ouvertes</h2>
      <ul className="flex flex-col gap-3">
        {sessions.map((session) => {
          const full = session.attendanceCapacity !== null && session.confirmedCount >= session.attendanceCapacity;
          return (
            <li key={session.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{formatDateTimeFr(session.date)}</p>
                  <span className="text-xs text-muted">{session.visibility === "PUBLIC" ? "Publique" : "Sur candidature"}</span>
                </div>
                <p className="text-sm text-muted">
                  Organisée par {session.organizerName}
                  {session.decidedGameName ? ` · ${session.decidedGameName}` : ""}
                  {session.attendanceCapacity !== null ? ` · ${session.confirmedCount}/${session.attendanceCapacity} places` : ""}
                  {session.waitlistCount > 0 ? ` · ${session.waitlistCount} en liste d'attente` : ""}
                </p>
                {session.visibility === "PUBLIC" ? (
                  <form action={joinPublicSessionAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <Button type="submit" variant="primary" size="sm">
                      {full ? "Rejoindre la liste d'attente" : "Rejoindre"}
                    </Button>
                  </form>
                ) : session.applicationStatus === "PENDING" ? (
                  <form action={withdrawSessionApplicationAction} className="flex items-center gap-2">
                    <input type="hidden" name="sessionId" value={session.id} />
                    <span className="text-sm text-muted">Candidature envoyée, en attente.</span>
                    <Button type="submit" variant="secondary" size="sm">Retirer</Button>
                  </form>
                ) : session.applicationStatus === "DECLINED" ? (
                  <p className="text-sm text-muted">Candidature non retenue.</p>
                ) : (
                  <form action={applyToSessionAction} className="flex flex-col gap-2">
                    <input type="hidden" name="sessionId" value={session.id} />
                    <textarea
                      name="message"
                      rows={2}
                      maxLength={300}
                      placeholder="Un mot pour l'organisateur (facultatif)"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
                    />
                    <Button type="submit" variant="primary" size="sm">Candidater</Button>
                  </form>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
