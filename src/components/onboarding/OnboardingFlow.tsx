"use client";

import { useRef, useState, type TouchEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { completeOnboardingAction } from "@/app/onboarding-actions";

const SWIPE_MIN_DISTANCE_PX = 50;
const SCREEN_COUNT = 4;

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -60 : 60, opacity: 0 }),
};

/**
 * Onboarding premier login (Sprint 2 PR-B, U1) — 4 écrans plein écran,
 * navigation par swipe horizontal (mêmes seuils que le swipe jour de
 * `DayTimeline`) ou boutons, "Passer" toujours visible. Monté
 * inconditionnellement par la home (jamais côté serveur si
 * `shouldShowOnboarding` est faux — ce composant ne fait QUE l'affichage
 * une fois qu'on sait déjà qu'il faut le montrer), état local `open`
 * fermé immédiatement au clic plutôt que d'attendre la réponse serveur de
 * `completeOnboardingAction` — l'action est silencieuse (garde
 * `revalidatePath`), pas besoin de bloquer l'UI dessus.
 */
export function OnboardingFlow({
  discordName,
  discordAvatar,
  xpTotal,
  badgeCount,
}: {
  discordName: string;
  discordAvatar: string | null;
  xpTotal: number;
  badgeCount: number;
}) {
  const [open, setOpen] = useState(true);
  const [screen, setScreen] = useState(0);
  const [direction, setDirection] = useState(1);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function finish() {
    setOpen(false);
    completeOnboardingAction();
  }

  function goTo(next: number) {
    if (next < 0 || next >= SCREEN_COUNT) return;
    setDirection(next > screen ? 1 : -1);
    setScreen(next);
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const deltaX = t.clientX - touchStart.current.x;
    const deltaY = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    goTo(deltaX < 0 ? screen + 1 : screen - 1);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center justify-end p-4">
        <button
          type="button"
          onClick={finish}
          className="rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          Passer
        </button>
      </div>

      <div
        className="relative flex-1 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence custom={direction} mode="wait">
          {screen === 0 && (
            <motion.div
              key="0"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
            >
              <Avatar src={discordAvatar} alt={discordName} size={96} />
              <div>
                <h2 className="text-2xl font-semibold text-foreground">
                  Bienvenue sur GameNight 🎮
                </h2>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Salut {discordName} ! Prêt à organiser plein de soirées
                  jeux avec tes potes ?
                </p>
              </div>
            </motion.div>
          )}
          {screen === 1 && (
            <motion.div
              key="1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
            >
              <span className="text-6xl" aria-hidden>
                📅
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Règle tes dispos</h2>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Indique quand tu es dispo pour jouer — le calendrier
                  montre en un coup d&apos;œil les meilleurs créneaux avec
                  le groupe.
                </p>
              </div>
              <ButtonLink href="/calendrier" variant="secondary" onClick={finish}>
                Aller au calendrier
              </ButtonLink>
            </motion.div>
          )}
          {screen === 2 && (
            <motion.div
              key="2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
            >
              <span className="text-6xl" aria-hidden>
                🎯
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">Propose une soirée</h2>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Choisis une date, tes potes votent pour le jeu — la
                  soirée s&apos;organise toute seule.
                </p>
              </div>
              <ButtonLink href="/sessions" variant="secondary" onClick={finish}>
                Voir les soirées
              </ButtonLink>
            </motion.div>
          )}
          {screen === 3 && (
            <motion.div
              key="3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
            >
              <span className="text-6xl" aria-hidden>
                🔥
              </span>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">C&apos;est parti !</h2>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Tu gagnes de l&apos;XP, débloques des rangs et des
                  badges à chaque soirée.
                </p>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface px-4 py-3">
                  <span className="text-lg font-bold text-foreground">{xpTotal}</span>
                  <span className="text-[11px] text-muted">XP</span>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface px-4 py-3">
                  <span className="text-lg font-bold text-foreground">{badgeCount}</span>
                  <span className="text-[11px] text-muted">
                    badge{badgeCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col items-center gap-4 p-6">
        <div className="flex gap-2">
          {Array.from({ length: SCREEN_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === screen ? "bg-accent" : "bg-surface-hover"
              }`}
            />
          ))}
        </div>
        <div className="flex w-full max-w-xs gap-3">
          {screen > 0 && (
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => goTo(screen - 1)}>
              Précédent
            </Button>
          )}
          {screen < SCREEN_COUNT - 1 ? (
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => goTo(screen + 1)}
            >
              Suivant
            </Button>
          ) : (
            <Button variant="primary" size="sm" className="flex-1" onClick={finish}>
              Commencer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
