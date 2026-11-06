import { Button } from "@/components/ui/Button";
import { formatDateTimeFr } from "@/lib/wallclock";
import {
  grantVoicePresenceConsentAction,
  withdrawVoicePresenceConsentAction,
} from "@/app/sessions/actions/voice-presence";

type VoicePresence = NonNullable<Awaited<ReturnType<typeof import("@/lib/session-voice-presence").readSessionVoicePresence>>>;

function formatDuration(seconds: number) {
  if (seconds < 60) return "moins d’une minute";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
}

export function SessionVoicePresencePanel({
  sessionId,
  presence,
  result,
}: {
  sessionId: string;
  presence: VoicePresence;
  result?: string;
}) {
  const message = result === "consented"
    ? "Ton consentement est enregistré."
    : result === "withdrawn"
      ? "Ton consentement et tes durées ont été supprimés."
      : result === "disabled"
        ? "La collecte est désactivée pour le moment."
        : result === "unavailable"
          ? "Le consentement n’a pas pu être modifié. Vérifie que tu es toujours invité et que la soirée est ouverte."
          : null;

  return (
    <section aria-label="Présence vocale" className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">Présence vocale Discord</h2>
      <p className="mt-1 text-sm text-muted">
        L&apos;enregistrement est individuel. Les durées sont visibles par toi, le créateur et les admins autorisés, puis supprimées après 30 jours.
      </p>

      {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
      {!presence.enabled && (
        <p className="mt-3 text-sm text-muted">La collecte est désactivée. Aucun nouvel intervalle n&apos;est enregistré; tu peux toujours retirer ton consentement.</p>
      )}

      {presence.canConsent && !presence.consented && presence.enabled && (
        <form action={grantVoicePresenceConsentAction} className="mt-3">
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="primary" size="sm">J&apos;accepte le suivi de ma présence vocale</Button>
        </form>
      )}
      {presence.canConsent && !presence.consented && !presence.enabled && (
        <p className="mt-2 text-sm text-muted">Tu pourras donner ton accord quand la collecte sera activée.</p>
      )}
      {presence.canWithdraw && (
        <form action={withdrawVoicePresenceConsentAction} className="mt-3">
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="secondary" size="sm">Retirer mon consentement et supprimer mes durées</Button>
        </form>
      )}

      {presence.gapPeriods.length > 0 && (
        <div className="mt-3 rounded-lg bg-warning/10 p-3 text-sm text-warning">
          <p>Les lacunes de mesure connues (aucune durée n&apos;est estimée) :</p>
          <ul className="mt-2 space-y-1">
            {presence.gapPeriods.map((gap, index) => (
              <li key={`${gap.startedAt.toISOString()}-${index}`}>
                Du {formatDateTimeFr(gap.startedAt)}
                {gap.resumedAt
                  ? ` à ${formatDateTimeFr(gap.resumedAt)} (reprise confirmée).`
                  : "; aucune reprise n’a encore été confirmée."}
              </li>
            ))}
          </ul>
        </div>
      )}

      {presence.entries.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {presence.entries.map(member => (
            <li key={member.userId}>
              {member.name} — {formatDuration(member.durationSeconds)}
              {member.partial && <span className="text-muted"> (mesure partielle)</span>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-muted">Aucune durée enregistrée.</p>}
    </section>
  );
}
