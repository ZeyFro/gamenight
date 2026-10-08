"use client";

import { CreationForm } from "@/components/CreationForm";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { createSessionFromRouletteAction } from "@/app/roulette/actions";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { haptics } from "@/lib/haptics";
import {
  RouletteWheelDisplay,
  computeWinningRotation,
  type WheelSegment,
} from "@/components/roulette/RouletteWheelDisplay";

export interface RouletteGame {
  id: string;
  name: string;
  coverUrl: string | null;
}

export interface RouletteCandidate {
  id: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
  games: RouletteGame[];
}

const SPIN_DURATION_S = 3.6;
const TICK_INTERVAL_MS = 90;
const GAMES_PER_PARTICIPANT = 2;

/**
 * Roue du gambling (Sprint 3) — wizard 2 étapes en un seul composant
 * client (état riche : participants, sélections de jeux, animation).
 * Le créateur pilote toute l'interface, y compris le choix des 2 jeux
 * "pour" un pote absent (spec) — il n'y a pas de session multi-device en
 * temps réel ici, donc "le créateur choisit pour lui" est structurellement
 * la seule interaction possible, pas un mode spécial à coder à part.
 */
export function RouletteWizard({
  candidates,
  defaultDate,
  soundEnabled,
}: {
  candidates: RouletteCandidate[];
  defaultDate: string;
  soundEnabled: boolean;
}) {
  const creator = candidates[0];
  const [participantIds, setParticipantIds] = useState<string[]>([creator.id]);
  const [selections, setSelections] = useState<Record<string, RouletteGame[]>>({});
  const [phase, setPhase] = useState<"prep" | "wheel">("prep");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winnerGame, setWinnerGame] = useState<RouletteGame | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("20:00");
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const participants = candidates.filter((c) => participantIds.includes(c.id));
  const allReady =
    participants.length >= 2 &&
    participants.every((p) => (selections[p.id]?.length ?? 0) === GAMES_PER_PARTICIPANT);

  const segments = useMemo(() => {
    const list: { userId: string; game: RouletteGame }[] = [];
    for (const p of participants) {
      for (const g of selections[p.id] ?? []) list.push({ userId: p.id, game: g });
    }
    return list;
  }, [participants, selections]);

  function toggleParticipant(id: string) {
    if (id === creator.id) return;
    haptics.light();
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setSelections((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function addGame(userId: string, game: RouletteGame) {
    setSelections((prev) => {
      const current = prev[userId] ?? [];
      if (current.length >= GAMES_PER_PARTICIPANT || current.some((g) => g.id === game.id)) {
        return prev;
      }
      return { ...prev, [userId]: [...current, game] };
    });
  }

  function removeGame(userId: string, gameId: string) {
    setSelections((prev) => ({
      ...prev,
      [userId]: (prev[userId] ?? []).filter((g) => g.id !== gameId),
    }));
  }

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

  function spin() {
    if (segments.length === 0) return;
    haptics.medium();
    setWinnerGame(null);
    setCelebrate(false);
    setSpinning(true);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);

    const winnerIndex = Math.floor(Math.random() * segments.length);
    setRotation(computeWinningRotation(rotation, winnerIndex, segments.length));

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
    setTimeout(() => {
      setSpinning(false);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      setCelebrate(true);
      flashTimeoutRef.current = setTimeout(() => {
        setWinnerGame(segments[winnerIndex].game);
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
  }

  function handleLaunch() {
    setPhase("wheel");
    requestAnimationFrame(() => spin());
  }

  const wheelSegments: WheelSegment[] = segments.map((seg) => ({
    key: `${seg.userId}-${seg.game.id}`,
    label: seg.game.name,
  }));

  if (phase === "wheel") {
    return (
      <div className="flex flex-col items-center gap-6">
        <RouletteWheelDisplay
          segments={wheelSegments}
          rotation={rotation}
          durationS={SPIN_DURATION_S}
          spinning={spinning}
          celebrate={celebrate}
        />

        {winnerGame && !spinning && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-4"
          >
            <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent/10 p-4">
              {winnerGame.coverUrl && (
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                  <Image
                    src={winnerGame.coverUrl}
                    alt=""
                    width={44}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div>
                <p className="font-semibold text-foreground">{winnerGame.name}</p>
                <p className="text-sm text-accent">🎉 C&apos;est parti !</p>
              </div>
            </div>

            <CreationForm action={createSessionFromRouletteAction} className="flex w-full flex-col gap-3">
              <input type="hidden" name="gameId" value={winnerGame.id} />
              {participants.map((p) => (
                <input key={p.id} type="hidden" name="participantId" value={p.id} />
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="roulette-date">
                    Date
                  </label>
                  <input
                    id="roulette-date"
                    type="date"
                    name="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="roulette-time">
                    Heure
                  </label>
                  <input
                    id="roulette-time"
                    type="time"
                    name="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
              </div>
              <Button type="submit" variant="primary" fullWidthOnMobile>
                Créer la soirée
              </Button>
            </CreationForm>

            <Button type="button" variant="secondary" fullWidthOnMobile onClick={spin}>
              🔄 Relancer
            </Button>
          </motion.div>
        )}

        {spinning && <p className="text-sm text-muted">La roue tourne…</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-foreground">Participants</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 rounded-lg border border-accent bg-accent/10 px-3 py-2 text-sm text-foreground">
            <Avatar src={creator.discordAvatar} alt={creator.discordName} size={28} />
            <span className="flex-1">{creator.discordName} (toi)</span>
          </div>
          {candidates.slice(1).map((pote) => {
            const checked = participantIds.includes(pote.id);
            return (
              <label
                key={pote.id}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleParticipant(pote.id)}
                  className="h-5 w-5 shrink-0 rounded border-border accent-accent"
                />
                <Avatar src={pote.discordAvatar} alt={pote.discordName} size={28} />
                <span className="flex-1 truncate">{pote.discordName}</span>
              </label>
            );
          })}
        </div>
        {participants.length < 2 && (
          <p className="text-xs text-muted">Minimum 2 participants pour lancer la roue.</p>
        )}
      </Card>

      {participants.map((p) => (
        <ParticipantGamesCard
          key={p.id}
          participant={p}
          selected={selections[p.id] ?? []}
          onAdd={(game) => addGame(p.id, game)}
          onRemove={(gameId) => removeGame(p.id, gameId)}
        />
      ))}

      <Button
        type="button"
        variant="primary"
        fullWidthOnMobile
        disabled={!allReady}
        onClick={handleLaunch}
      >
        Lancer la roulette 🎰
      </Button>
    </div>
  );
}

function ParticipantGamesCard({
  participant,
  selected,
  onAdd,
  onRemove,
}: {
  participant: RouletteCandidate;
  selected: RouletteGame[];
  onAdd: (game: RouletteGame) => void;
  onRemove: (gameId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const full = selected.length >= GAMES_PER_PARTICIPANT;

  const filtered = participant.games
    .filter((g) => !selected.some((s) => s.id === g.id))
    .filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Avatar src={participant.discordAvatar} alt={participant.discordName} size={24} />
        <p className="text-sm font-medium text-foreground">{participant.discordName}</p>
        <span className="ml-auto text-xs text-muted">
          {selected.length}/{GAMES_PER_PARTICIPANT} jeux
        </span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((g) => (
            <span
              key={g.id}
              className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 py-1 pr-1 pl-2 text-xs text-foreground"
            >
              {g.name}
              <button
                type="button"
                onClick={() => onRemove(g.id)}
                aria-label={`Retirer ${g.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!full && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un jeu de sa biblio…"
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {query && (
            <ul className="flex max-h-40 flex-col overflow-y-auto rounded-lg border border-border bg-surface">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">Aucun jeu trouvé.</li>
              )}
              {filtered.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(g);
                      setQuery("");
                    }}
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
                  >
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {participant.games.length === 0 && (
        <p className="text-xs text-muted">Aucun jeu dans sa bibliothèque.</p>
      )}
    </Card>
  );
}
