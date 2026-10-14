"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EndInstantSessionDialog } from "@/components/jouer-maintenant/EndInstantSessionDialog";
import { ChangeInstantSessionGameControl } from "@/components/jouer-maintenant/ChangeInstantSessionGameControl";
import type { LocalGameOption } from "@/lib/game-search";
import type { InstantSessionViewDTO } from "@/lib/instant-sessions";
import { INSTANT_SESSION_ELIGIBLE_PRESENCE_MS } from "@/lib/instant-session-constants";
import {
  getInstantSessionViewAction,
  joinInstantSessionAction,
  leaveInstantSessionAction,
} from "@/app/jouer-maintenant/actions";
import { INITIAL_INSTANT_SESSION_ACTION_STATE } from "@/app/jouer-maintenant/action-state";

const POLL_INTERVAL_MS = 30_000;

/** `HH:MM` ou `MM:SS` selon la grandeur restante — countdown précis,
 * distinct de `formatDurationFr` (trop grossier — "1 h" — pour un compte
 * à rebours affiché en direct). */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatEligibleProgress(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Détail d'une session instantanée ("Jouer maintenant", V2) — actualisation
 * 30s quand l'onglet est visible, MÊME pattern que `ChatMessages`
 * (chat/ChatMessages.tsx) : un seul intervalle, jamais plusieurs boucles
 * concurrentes (guard `if (interval) return`), coupé dès que l'onglet
 * passe en arrière-plan, relancé avec un fetch immédiat au retour visible.
 *
 * Le serveur fait TOUJOURS autorité : chaque poll relit l'état réel
 * (`getInstantSessionViewAction` règle expiration/récompenses au passage)
 * — ce composant n'invente jamais un état local qui diverge de la
 * dernière réponse serveur connue, seul le countdown visuel "tique" une
 * fois par seconde ENTRE deux polls, recalculé depuis `expiresAtIso`
 * (jamais un compteur qui dérive de sa propre initialisation).
 */
export function InstantSessionDetail({
  instantSessionId,
  currentUserId,
  initialView,
  localGames,
}: {
  instantSessionId: string;
  currentUserId: string;
  initialView: InstantSessionViewDTO;
  localGames: LocalGameOption[];
}) {
  const [view, setView] = useState(initialView);
  const [pollError, setPollError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [joinState, joinAction, joinPending] = useActionState(
    joinInstantSessionAction,
    INITIAL_INSTANT_SESSION_ACTION_STATE
  );
  const [leaveState, leaveAction, leavePending] = useActionState(
    leaveInstantSessionAction,
    INITIAL_INSTANT_SESSION_ACTION_STATE
  );

  const refreshRef = useRef(false);
  async function refresh() {
    if (refreshRef.current || document.hidden) return;
    refreshRef.current = true;
    try {
      const fresh = await getInstantSessionViewAction(instantSessionId);
      if (fresh) {
        setView(fresh);
        setPollError(false);
      } else {
        setPollError(true);
      }
    } catch { setPollError(true); }
    finally { refreshRef.current = false; }
  }

  // Rafraîchit immédiatement après une action réussie (rejoindre/quitter)
  // — pas besoin d'attendre le prochain tick de 30s pour refléter son
  // propre changement. `refresh` est asynchrone (elle attend la réponse
  // serveur avant d'appeler `setView`) — jamais un `setState` synchrone
  // dans le corps de l'effet lui-même.
  useEffect(() => {
    if (joinState.status !== "success" && leaveState.status !== "success") return;
    let cancelled = false;
    getInstantSessionViewAction(instantSessionId).then((fresh) => {
      if (cancelled) return;
      if (fresh) {
        setView(fresh);
        setPollError(false);
      } else {
        setPollError(true);
      }
    }).catch(() => { if (!cancelled) setPollError(true); });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinState, leaveState]);

  // Polling 30s conscient de la visibilité — voir le commentaire de
  // fichier ci-dessus, identique à `ChatMessages`.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (interval || view.status !== "ACTIVE") return;
      interval = setInterval(refresh, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }
    function syncWithVisibility() {
      if (document.hidden) {
        stopPolling();
      } else if (view.status === "ACTIVE") {
        refresh();
        startPolling();
      }
    }

    syncWithVisibility();
    document.addEventListener("visibilitychange", syncWithVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", syncWithVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instantSessionId, view.status]);

  // Tick visuel du countdown — 1x/s, purement affichage, ne modifie jamais
  // `view` (source de vérité serveur seule).
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (view.status !== "ACTIVE") return;
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [view.status]);

  const isEnded = view.status === "ENDED";
  // Dérivé d'un horodatage ABSOLU (`expiresAtIso`), jamais d'un delta
  // depuis un instant de fetch mémorisé — évite tout état/ref supplémentaire
  // à synchroniser ; une légère dérive horloge client/serveur est sans
  // conséquence pour un simple affichage cosmétique (le serveur reste seul
  // à faire autorité sur l'expiration réelle, voir `settleInstantSessionIfDue`).
  const liveRemainingMs = isEnded
    ? 0
    : Math.max(0, new Date(view.expiresAtIso).getTime() - nowMs);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {isEnded ? "Session terminée" : "Jouer maintenant"}
          </p>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{view.game.name}</h1>
        </div>
        {!isEnded && (
          <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            ⏳ {formatCountdown(liveRemainingMs)}
          </span>
        )}
        {isEnded && (
          <span className="shrink-0 rounded-full bg-surface-hover px-3 py-1 text-xs font-medium text-muted">
            Terminée
          </span>
        )}
      </div>

      {pollError && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          Actualisation impossible pour le moment — les informations affichées datent du dernier
          chargement réussi.
        </p>
      )}
      {isEnded && (
        <p className="rounded-lg bg-surface p-3 text-sm text-muted">
          {view.endedReason === "expired"
            ? "Cette session a atteint sa durée maximale (3h) et s'est terminée automatiquement."
            : "Le créateur a terminé cette session pour tout le monde."}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Avatar src={view.creator.discordAvatar} alt="" size={24} ringColor={view.creator.color} />
          <span>
            Créée par <span className="font-medium text-foreground">{view.creator.discordName}</span>
          </span>
        </div>
        <p className="text-xs text-faint">
          Présence déclarée dans GameNight — pas une mesure de temps réellement joué sur Steam.
          Fermer le navigateur ne compte jamais automatiquement comme un départ, il faut cliquer
          « Quitter ».
        </p>
      </div>

      {!isEnded && !view.viewerIsParticipant && (
        <form action={joinAction}>
          <input type="hidden" name="instantSessionId" value={instantSessionId} />
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={joinPending}>
            {joinPending ? "…" : "Rejoindre 🎮"}
          </Button>
        </form>
      )}
      {joinState.status === "error" && (
        <p className="text-sm text-destructive">
          {joinState.errorReason === "already_in_another_session"
            ? "Tu es déjà dans une autre session instantanée active — quitte-la d'abord."
            : "Impossible de rejoindre pour le moment."}
        </p>
      )}

      {!isEnded && view.viewerIsParticipant && !view.viewerIsCreator && (
        <form action={leaveAction}>
          <input type="hidden" name="instantSessionId" value={instantSessionId} />
          <Button type="submit" variant="secondary" fullWidthOnMobile disabled={leavePending}>
            {leavePending ? "…" : "Quitter"}
          </Button>
        </form>
      )}
      {leaveState.status === "error" && (
        <p className="text-sm text-destructive">Impossible de quitter pour le moment.</p>
      )}

      {!isEnded && view.viewerIsCreator && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Outils du créateur</p>
          <ChangeInstantSessionGameControl instantSessionId={instantSessionId} localGames={localGames} />
          <EndInstantSessionDialog instantSessionId={instantSessionId} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">
          Participants ({view.participants.length})
        </p>
        <ul className="flex flex-col gap-2">
          {view.participants.map((p) => (
            <li
              key={p.userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={p.discordAvatar} alt="" size={36} ringColor={p.color} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.discordName}
                    {p.userId === view.creator.id ? " · créateur" : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {p.isPresent ? "Présent" : "Parti"}
                    {p.eligible
                      ? " · XP acquise ✅"
                      : ` · ${formatEligibleProgress(p.coPresenceMs)} / ${formatEligibleProgress(INSTANT_SESSION_ELIGIBLE_PRESENCE_MS)} avec au moins un autre participant`}
                  </p>
                </div>
              </div>
              {p.userId === currentUserId && (
                <span className="shrink-0 text-xs text-faint">toi</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
