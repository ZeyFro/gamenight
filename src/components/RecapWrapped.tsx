"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { MonthlyRecapData } from "@/lib/monthly-recap";

/**
 * Sprint 4 (FEATURE 2, Recap mensuel Wrapped) — style Spotify Wrapped :
 * une stat par écran, scroll-snap vertical (le "tap ou auto-scroll" de la
 * spec — un swipe/scroll fait défiler d'un écran à l'autre, pas de
 * bouton "suivant" à construire) et une révélation `whileInView` à
 * l'entrée dans le viewport, plutôt que `Stagger`/`StaggerItem`
 * (composants motion existants) qui animent tout au montage — ici chaque
 * stat doit apparaître au moment où on scrolle jusqu'à elle, pas toutes
 * en même temps à l'ouverture de la page.
 */
function WrappedSection({ children }: { children: ReactNode }) {
  return (
    <section className="flex h-[100dvh] w-full shrink-0 snap-start flex-col items-center justify-center gap-4 px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="flex flex-col items-center gap-3"
      >
        {children}
      </motion.div>
    </section>
  );
}

function StatValue({ children }: { children: ReactNode }) {
  return (
    <p className="text-5xl font-bold text-white drop-shadow-lg sm:text-6xl">{children}</p>
  );
}

function StatLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm uppercase tracking-widest text-white/60">{children}</p>;
}

export function RecapWrapped({
  data,
  monthLabel,
}: {
  data: MonthlyRecapData;
  monthLabel: string;
}) {
  return (
    <div
      className="h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto"
      style={{ background: "linear-gradient(180deg, #8b5cf6 0%, #2e1065 35%, #000000 100%)" }}
    >
      <WrappedSection>
        <p className="text-lg text-white/70">📊 Recap</p>
        <StatValue>{monthLabel}</StatValue>
        <p className="text-sm text-white/50">Scrolle pour découvrir le mois ↓</p>
      </WrappedSection>

      <WrappedSection>
        <StatLabel>Soirées jouées</StatLabel>
        <StatValue>{data.sessionsPlayed}</StatValue>
      </WrappedSection>

      {data.mostPlayedGame && (
        <WrappedSection>
          <StatLabel>Jeu le plus joué</StatLabel>
          <StatValue>{data.mostPlayedGame.name}</StatValue>
          <p className="text-white/70">
            {data.mostPlayedGame.count} fois
          </p>
        </WrappedSection>
      )}

      {data.mvpOfMonth && (
        <WrappedSection>
          <StatLabel>🏆 MVP du mois</StatLabel>
          <StatValue>{data.mvpOfMonth.discordName}</StatValue>
          <p className="text-white/70">{data.mvpOfMonth.count} fois élu MVP</p>
        </WrappedSection>
      )}

      {data.mostActive && (
        <WrappedSection>
          <StatLabel>Joueur le plus actif</StatLabel>
          <StatValue>{data.mostActive.discordName}</StatValue>
          <p className="text-white/70">{data.mostActive.count} soirées</p>
        </WrappedSection>
      )}

      {data.bestStreak && (
        <WrappedSection>
          <StatLabel>🔥 Meilleur streak</StatLabel>
          <StatValue>{data.bestStreak.discordName}</StatValue>
          <p className="text-white/70">{data.bestStreak.streak} jours d&apos;affilée</p>
        </WrappedSection>
      )}

      {data.bestPronostiqueur && (
        <WrappedSection>
          <StatLabel>🔮 Meilleur pronostiqueur</StatLabel>
          <StatValue>{data.bestPronostiqueur.discordName}</StatValue>
          <p className="text-white/70">{data.bestPronostiqueur.count} pronos corrects</p>
        </WrappedSection>
      )}

      <WrappedSection>
        <StatLabel>XP total du groupe</StatLabel>
        <StatValue>{data.totalGroupXp.toLocaleString("fr-FR")}</StatValue>
        <p className="text-sm text-white/50">Rendez-vous le mois prochain 👋</p>
      </WrappedSection>
    </div>
  );
}
