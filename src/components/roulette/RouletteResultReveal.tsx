"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { ButtonLink } from "@/components/ui/Button";
import {
  RouletteWheelDisplay,
  computeWinningRotation,
  type WheelSegment,
} from "@/components/roulette/RouletteWheelDisplay";
import { haptics } from "@/lib/haptics";

const SPIN_DURATION_S = 3.6;
const TICK_INTERVAL_MS = 90;

/**
 * Révélation du résultat pour qui visite `/roulette/[id]` une fois le
 * tirage fait (`status: DONE`) — le gagnant est DÉJÀ décidé côté serveur
 * (`spinRoulette`, potentiellement via le cron, sans personne présent) :
 * ce composant rejoue juste l'animation de roue jusqu'au résultat connu
 * (`computeWinningRotation` avec l'index du jeu gagnant), pour donner la
 * même sensation de "tirage" que le mode instant à quiconque arrive dans
 * les minutes/heures qui suivent. Toutes les propositions sont visibles
 * ici sans problème : la roulette est déjà tranchée, il n'y a plus rien
 * à garder "surprise".
 */
export function RouletteResultReveal({
  ...props
}: Parameters<typeof RouletteResultAnimation>[0]) {
  return <RouletteResultAnimation key={props.winnerGameId} {...props} />;
}

function RouletteResultAnimation({
  entries,
  winnerGameId,
  winnerGameName,
  winnerGameCoverUrl,
  sessionId,
  soundEnabled,
}: {
  entries: { userId: string; game: { id: string; name: string } }[];
  winnerGameId: string;
  winnerGameName: string;
  winnerGameCoverUrl: string | null;
  sessionId: string;
  soundEnabled: boolean;
}) {
  const segments: WheelSegment[] = entries.map((e) => ({
    key: `${e.userId}-${e.game.id}`,
    label: e.game.name,
  }));
  const winnerIndex = entries.findIndex((e) => e.game.id === winnerGameId);
  const canSpin = winnerIndex !== -1 && segments.length > 0;

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
      void audio.play().catch(() => {
        // Ignoré — lecture auto potentiellement bloquée hors geste utilisateur.
      });
    } catch {
      // Ignoré — jamais bloquant.
    }
  }

  // Son "DING" distinct du tic-tic de rotation (Amélioration des features
  // existantes, PR-B, item 6) — réutilise `achievement.wav` (déjà présent
  // pour les badges) plutôt qu'un nouvel asset audio.
  function playVictory() {
    if (!soundEnabled) return;
    try {
      const audio = new Audio("/sounds/achievement.wav");
      audio.volume = 0.5;
      void audio.play().catch(() => {
        // Ignoré — lecture auto potentiellement bloquée hors geste utilisateur.
      });
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

    // Zoom-in + flash lumineux sur la roue AVANT les confettis (spec) —
    // un temps fort distinct plutôt que tout déclencher d'un coup à
    // l'arrêt de la roue.
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
    <div className="flex flex-col items-center gap-6">
      <RouletteWheelDisplay
        segments={segments}
        rotation={rotation}
        spinning={spinning}
        celebrate={celebrate}
      />

      {spinning && <p className="text-sm text-muted">La roue tourne…</p>}

      {revealed && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex w-full flex-col items-center gap-4"
        >
          <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent/10 p-4">
            {winnerGameCoverUrl && (
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                <Image
                  src={winnerGameCoverUrl}
                  alt=""
                  width={44}
                  height={64}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div>
              <p className="font-semibold text-foreground">{winnerGameName}</p>
              <p className="text-sm text-accent">🎉 C&apos;est parti !</p>
            </div>
          </div>
          <ButtonLink href={`/sessions/${sessionId}`} variant="primary" fullWidthOnMobile>
            Voir la soirée
          </ButtonLink>
        </motion.div>
      )}
    </div>
  );
}
