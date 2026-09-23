"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { Button, ButtonLink } from "@/components/ui/Button";
import {
  RouletteWheelDisplay,
  computeWinningRotation,
  type WheelSegment,
} from "@/components/roulette/RouletteWheelDisplay";
import { haptics } from "@/lib/haptics";
import { drawSessionGameAction } from "@/app/sessions/actions/draw";
import {
  INITIAL_DRAW_STATE,
  type DrawSessionGameActionState,
  type DrawSessionGameCandidate,
} from "@/app/sessions/actions/draw-types";

const SPIN_DURATION_S = 3.6;
const TICK_INTERVAL_MS = 90;

/**
 * V2 — remplace le lien "🎰 Roulette" cassé qui renvoyait vers le
 * formulaire générique de création d'une roulette (obligeant à ressaisir
 * la date et resélectionner les invités, au risque de créer une DEUXIÈME
 * soirée — bug remonté en test réel). Ce dialogue tire un jeu au sort
 * DIRECTEMENT pour LA MÊME soirée (même id/URL, mêmes invitations,
 * mêmes propositions/votes déjà enregistrés — voir `drawSessionGame`,
 * sessions.ts).
 *
 * `candidates` (prop) — aperçu des jeux ÉLIGIBLES au moment du chargement
 * de la page (même calcul `getProposalAvailability` que le badge
 * "JOUABLE" déjà affiché sur chaque proposition), purement informatif :
 * jamais transmis au serveur, jamais ce qui détermine le résultat. Le
 * serveur RECALCULE et COMMIT le tirage au moment de la confirmation
 * (`drawSessionGameAction`) — l'éventuel écart entre cet aperçu et le
 * résultat réel (une proposition retirée/ajoutée entre-temps) est géré
 * là-bas, jamais ici.
 */
export function DrawSessionGameDialog({
  sessionId,
  sessionDateLabel,
  groupLabel,
  candidates,
  soundEnabled,
}: {
  sessionId: string;
  sessionDateLabel: string;
  groupLabel: string;
  candidates: DrawSessionGameCandidate[];
  soundEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(drawSessionGameAction, INITIAL_DRAW_STATE);
  const router = useRouter();

  function closeAndRefresh() {
    setOpen(false);
    // `revalidatePath` (côté serveur, dans l'action) invalide déjà le
    // cache Next — `refresh()` fait relire la page SERVEUR immédiatement
    // plutôt que d'attendre une navigation, pour un "retour naturel vers
    // la même soirée" qui reflète tout de suite le nouvel état (jeu
    // décidé, vote clos).
    router.refresh();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Fermeture (croix, overlay, touche Échap) AVANT toute
        // confirmation — aucune mutation n'a eu lieu, rien à annuler ni à
        // rafraîchir, contrairement à `closeAndRefresh`.
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" size="sm">
          🎲 Tirer un jeu au sort
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
          >
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Tirer un jeu au sort
            </Dialog.Title>
            {/* Contexte de la soirée TOUJOURS visible — jamais à ressaisir. */}
            <Dialog.Description className="mt-1 text-sm text-muted">
              {sessionDateLabel} · {groupLabel}
            </Dialog.Description>

            {state.status === "drawn" ? (
              <DrawReveal
                state={state}
                sessionId={sessionId}
                soundEnabled={soundEnabled}
                onDone={closeAndRefresh}
              />
            ) : (
              <DrawConfirmStep
                sessionId={sessionId}
                candidates={candidates}
                pending={pending}
                actionState={state}
                formAction={formAction}
                onCancel={() => setOpen(false)}
                onAlreadyDecided={closeAndRefresh}
              />
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawConfirmStep({
  sessionId,
  candidates,
  pending,
  actionState,
  formAction,
  onCancel,
  onAlreadyDecided,
}: {
  sessionId: string;
  candidates: DrawSessionGameCandidate[];
  pending: boolean;
  actionState: DrawSessionGameActionState;
  formAction: (formData: FormData) => void;
  onCancel: () => void;
  onAlreadyDecided: () => void;
}) {
  const wheelSegments: WheelSegment[] = candidates.map((c) => ({ key: c.id, label: c.name }));

  return (
    <div className="mt-4 flex flex-col gap-4">
      {actionState.status === "already_decided" && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Cette soirée a déjà été décidée (ou annulée) entre-temps — quelqu&apos;un
          d&apos;autre a dû clôturer le vote pendant ce tirage.
        </p>
      )}
      {actionState.status === "no_eligible_game" && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Aucun jeu proposé n&apos;est actuellement jouable (assez de personnes
          dispos qui le possèdent) — retourne aux propositions pour en ajouter ou
          attendre que quelqu&apos;un se déclare disponible.
        </p>
      )}
      {actionState.status === "error" && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Une erreur est survenue — réessaie dans un instant.
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun jeu proposé n&apos;est actuellement jouable (assez de personnes
          dispos qui le possèdent). Retourne aux propositions pour en ajouter, ou
          attends que quelqu&apos;un se déclare disponible.
        </p>
      ) : candidates.length === 1 ? (
        <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent/10 p-3">
          {candidates[0].coverUrl && (
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-hover">
              <Image
                src={candidates[0].coverUrl}
                alt=""
                width={44}
                height={64}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <p className="text-sm text-foreground">
            Un seul jeu est actuellement jouable :{" "}
            <span className="font-semibold">{candidates[0].name}</span>. Valider ce
            choix clôturera le vote et retiendra ce jeu pour cette soirée.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <RouletteWheelDisplay segments={wheelSegments} rotation={0} sizePx={220} />
          <p className="text-center text-sm text-muted">
            {candidates.length} jeux jouables. Lancer le tirage clôturera le vote et
            retiendra le jeu tiré au sort pour cette soirée.
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          {candidates.length === 0 ? "Retour aux propositions" : "Annuler"}
        </Button>
        {candidates.length > 0 &&
          (actionState.status === "already_decided" ? (
            <Button type="button" variant="primary" className="flex-1" onClick={onAlreadyDecided}>
              Voir l&apos;état actuel
            </Button>
          ) : (
            <form action={formAction} className="flex-1">
              <input type="hidden" name="sessionId" value={sessionId} />
              <Button type="submit" variant="primary" className="w-full" disabled={pending}>
                {pending
                  ? "Tirage…"
                  : candidates.length === 1
                    ? `Valider ${candidates[0].name}`
                    : "Lancer le tirage"}
              </Button>
            </form>
          ))}
      </div>
    </div>
  );
}

function DrawReveal({
  state,
  sessionId,
  soundEnabled,
  onDone,
}: {
  state: Extract<DrawSessionGameActionState, { status: "drawn" }>;
  sessionId: string;
  soundEnabled: boolean;
  onDone: () => void;
}) {
  const segments: WheelSegment[] = state.candidates.map((c) => ({ key: c.id, label: c.name }));
  const winnerIndex = state.candidates.findIndex((c) => c.id === state.winnerGameId);
  // Un seul candidat (ou gagnant introuvable, défensif) — jamais
  // d'animation de hasard trompeuse pour un résultat qui n'a jamais été
  // incertain (voir le commentaire de fichier).
  const canSpin = winnerIndex !== -1 && segments.length > 1;

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(canSpin);
  const [revealed, setRevealed] = useState(!canSpin);
  const [celebrate, setCelebrate] = useState(false);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);

  function playTick() {
    if (!soundEnabled) return;
    try {
      const audio = new Audio("/sounds/tick.wav");
      audio.volume = 0.4;
      void audio.play().catch(() => {});
    } catch {
      // Ignoré — jamais bloquant.
    }
  }

  function playVictory() {
    if (!soundEnabled) return;
    try {
      const audio = new Audio("/sounds/achievement.wav");
      audio.volume = 0.5;
      void audio.play().catch(() => {});
    } catch {
      // Ignoré — jamais bloquant.
    }
  }

  useEffect(() => {
    if (started.current || !canSpin) return;
    started.current = true;

    haptics.medium();
    setRotation(computeWinningRotation(0, winnerIndex, segments.length));

    let elapsed = 0;
    tickIntervalRef.current = setInterval(() => {
      elapsed += TICK_INTERVAL_MS;
      playTick();
      haptics.light();
      if (elapsed >= SPIN_DURATION_S * 1000 && tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    }, TICK_INTERVAL_MS);

    const CELEBRATE_FLASH_MS = 320;
    const timeout = setTimeout(() => {
      setSpinning(false);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      setCelebrate(true);
      flashTimeoutRef.current = setTimeout(() => {
        setRevealed(true);
        confetti({
          particleCount: 140,
          spread: 75,
          origin: { y: 0.6 },
          colors: ["#8b5cf6", "#a78bfa", "#facc15", "#f8fafc"],
        });
        haptics.success();
        playVictory();
      }, CELEBRATE_FLASH_MS);
    }, SPIN_DURATION_S * 1000);

    return () => {
      clearTimeout(timeout);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit tourner qu'une fois, au montage
  }, []);

  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      {canSpin && (
        <RouletteWheelDisplay
          segments={segments}
          rotation={rotation}
          durationS={SPIN_DURATION_S}
          spinning={spinning}
          celebrate={celebrate}
          sizePx={220}
        />
      )}
      {spinning && <p className="text-sm text-muted">La roue tourne…</p>}

      {revealed && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex w-full flex-col items-center gap-4"
        >
          <div className="flex w-full items-center gap-3 rounded-xl border border-accent bg-accent/10 p-4">
            {state.winnerGameCoverUrl && (
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                <Image
                  src={state.winnerGameCoverUrl}
                  alt=""
                  width={44}
                  height={64}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div>
              <p className="font-semibold text-foreground">{state.winnerGameName}</p>
              <p className="text-sm text-accent">🎉 Vote clos — soirée validée !</p>
            </div>
          </div>
          <ButtonLink
            href={`/sessions/${sessionId}`}
            variant="primary"
            fullWidthOnMobile
            onClick={onDone}
          >
            Voir la soirée
          </ButtonLink>
        </motion.div>
      )}
    </div>
  );
}
