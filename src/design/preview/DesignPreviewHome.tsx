"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { BentoCard, BentoGrid } from "../BentoCard";
import { BottomNav, type BottomNavItem } from "../BottomNav";
import { CalendarIcon, ClockIcon, CloseIcon, CrownIcon, FlameIcon, HomeIcon, TrophyIcon, UserIcon, UsersIcon } from "../icons";
import { LaunchFab } from "../LaunchFab";
import { SectionHeader } from "../SectionHeader";
import { StatTile } from "../StatTile";
import { tokens } from "../tokens";
import {
  FRIENDS,
  LEADERBOARD,
  ME,
  NEXT_SESSION,
  SHEET_OPTIONS,
  STATS,
  WEEKLY_CHALLENGE,
  XP,
} from "./fake-data";
import { PreviewAvatar } from "./PreviewAvatar";

/**
 * Accueil « centre de commande » — PRÉVISUALISATION. Données fictives
 * (`fake-data.ts`), aucune requête, aucune action réelle : les boutons
 * n'ont qu'un effet local (état React) pour sentir l'interface. Plein
 * écran (`gn-screen`) : il recouvre l'en-tête et la barre actuels de
 * l'app, qu'on ne modifie pas dans ce lot.
 */

const NAV_ITEMS: readonly BottomNavItem[] = [
  { id: "home", label: "Accueil", icon: <HomeIcon /> },
  { id: "soirees", label: "Soirées", icon: <CalendarIcon /> },
  { id: "classement", label: "Classement", icon: <TrophyIcon /> },
  { id: "profil", label: "Profil", icon: <UserIcon /> },
];

const EASE = [...tokens.motion.easing.standard] as [number, number, number, number];

const MEDALS: Record<number, string> = { 1: "gold", 2: "silver", 3: "bronze" };

type Rsvp = "yes" | "maybe" | null;

export function DesignPreviewHome() {
  const [tab, setTab] = useState("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rsvp, setRsvp] = useState<Rsvp>(null);
  const [note, setNote] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const demoNote = useCallback((text: string) => setNote(text), []);

  useEffect(() => {
    if (!sheetOpen) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const xpPercent = Math.round((XP.current / XP.target) * 100);
  const challengePercent = Math.round((WEEKLY_CHALLENGE.done / WEEKLY_CHALLENGE.total) * 100);

  return (
    <div className="gn-design gn-screen">
      <div className="gn-screen-inner">
        <header className="gn-pv-top">
          <div>
            <p className="gn-pv-kicker">Vendredi soir, c&apos;est bientôt</p>
            <h1 className="gn-pv-title">Salut {ME.name}</h1>
          </div>
          <PreviewAvatar name={ME.name} size={44} ring />
        </header>

        <p className="gn-pv-badge">Aperçu du design · données fictives</p>

        {tab !== "home" ? (
          <p className="gn-pv-note" role="status">
            Aperçu : seul l&apos;accueil est dessiné pour l&apos;instant.
          </p>
        ) : null}
        {note ? (
          <p className="gn-pv-note" role="status">
            {note}
          </p>
        ) : null}

        <BentoGrid>
          <BentoCard tone="violet" colSpan={2} mdColSpan={2} rowSpan={2} delay={0} aria-label="Prochaine soirée">
            <p className="gn-pv-eyebrow">
              <ClockIcon width={16} height={16} /> Prochaine soirée
            </p>
            <p className="gn-pv-hero-when">{NEXT_SESSION.when}</p>
            <p className="gn-pv-countdown">{NEXT_SESSION.countdown}</p>
            <p className="gn-pv-game">{NEXT_SESSION.game}</p>
            <div className="gn-pv-attendees">
              <div className="gn-pv-stack">
                {NEXT_SESSION.attendees.map((name) => (
                  <PreviewAvatar key={name} name={name} size={34} />
                ))}
              </div>
              <p className="gn-pv-muted">
                {NEXT_SESSION.confirmed} potes sur {NEXT_SESSION.total} ont confirmé
              </p>
            </div>
            <div className="gn-pv-actions">
              <button
                type="button"
                className="gn-btn"
                data-variant="primary"
                aria-pressed={rsvp === "yes"}
                onClick={() => setRsvp(rsvp === "yes" ? null : "yes")}
              >
                {rsvp === "yes" ? "Tu viens ✓" : "Je viens"}
              </button>
              <button
                type="button"
                className="gn-btn"
                data-variant="ghost"
                aria-pressed={rsvp === "maybe"}
                onClick={() => setRsvp(rsvp === "maybe" ? null : "maybe")}
              >
                Peut-être
              </button>
            </div>
          </BentoCard>

          <BentoCard tone="gold" colSpan={2} mdColSpan={2} delay={60} aria-label="XP et rang">
            <p className="gn-pv-eyebrow" data-tone="gold">
              <CrownIcon width={16} height={16} /> XP et rang
            </p>
            <div className="gn-pv-rank">
              <p className="gn-pv-rank-name">{ME.rank}</p>
              <p className="gn-pv-muted">Niveau {ME.level}</p>
            </div>
            <div
              className="gn-progress"
              role="progressbar"
              aria-label="Progression vers le rang suivant"
              aria-valuemin={0}
              aria-valuemax={XP.target}
              aria-valuenow={XP.current}
            >
              <motion.span
                className="gn-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${xpPercent}%` }}
                transition={{ duration: tokens.motion.duration.slow * 2.2 / 1000, ease: EASE }}
              />
            </div>
            <p className="gn-pv-muted">
              {XP.currentLabel} / {XP.targetLabel} XP · encore {XP.missingLabel} pour {ME.nextRank}
            </p>
          </BentoCard>

          <StatTile
            label="Série"
            value={STATS.streak.value}
            hint={STATS.streak.hint}
            icon={<FlameIcon width={16} height={16} />}
            delay={120}
          />
          <StatTile
            label="Victoires"
            value={STATS.wins.value}
            delta={{ text: STATS.wins.delta, positive: true }}
            icon={<TrophyIcon width={16} height={16} />}
            delay={160}
          />

          <BentoCard colSpan={2} mdColSpan={2} delay={200} aria-label="Classement">
            <SectionHeader
              title="Classement"
              subtitle="Saison d'automne"
              actionLabel="Tout voir"
              onAction={() => demoNote("Démo : la page Classement n'est pas encore branchée.")}
            />
            <ol className="gn-pv-list">
              {LEADERBOARD.map((row) => (
                <li key={row.rank} className="gn-pv-row" data-me={row.isMe ? "true" : "false"}>
                  <span className="gn-pv-rankbadge" data-medal={MEDALS[row.rank] ?? "none"}>
                    {row.rank}
                  </span>
                  <PreviewAvatar name={row.name} size={32} />
                  <span className="gn-pv-row-name">
                    {row.name}
                    {row.isMe ? <span className="gn-pv-me"> · toi</span> : null}
                  </span>
                  <span className="gn-pv-row-value">{row.xp} XP</span>
                </li>
              ))}
            </ol>
          </BentoCard>

          <BentoCard colSpan={2} mdColSpan={2} delay={240} aria-label="Potes en ligne">
            <SectionHeader title="Potes en ligne" subtitle="3 connectés en ce moment" />
            <ul className="gn-pv-list">
              {FRIENDS.map((friend) => (
                <li key={friend.name} className="gn-pv-row">
                  <PreviewAvatar name={friend.name} size={36} status={friend.status} />
                  <span className="gn-pv-row-name">{friend.name}</span>
                  <span className="gn-pv-status" data-status={friend.status}>
                    {friend.label}
                  </span>
                </li>
              ))}
            </ul>
          </BentoCard>

          <BentoCard tone="magenta" colSpan={2} mdColSpan={4} delay={280} aria-label="Défi de la semaine">
            <div className="gn-pv-challenge">
              <div>
                <p className="gn-pv-eyebrow" data-tone="magenta">
                  <UsersIcon width={16} height={16} /> Défi de la semaine
                </p>
                <p className="gn-pv-challenge-title">{WEEKLY_CHALLENGE.title}</p>
              </div>
              <p className="gn-pv-reward">{WEEKLY_CHALLENGE.reward}</p>
            </div>
            <div
              className="gn-progress"
              role="progressbar"
              aria-label="Progression du défi"
              aria-valuemin={0}
              aria-valuemax={WEEKLY_CHALLENGE.total}
              aria-valuenow={WEEKLY_CHALLENGE.done}
            >
              <motion.span
                className="gn-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${challengePercent}%` }}
                transition={{ duration: tokens.motion.duration.slow * 2.2 / 1000, ease: EASE }}
              />
            </div>
            <p className="gn-pv-muted">
              {WEEKLY_CHALLENGE.done} / {WEEKLY_CHALLENGE.total} parties gagnées
            </p>
          </BentoCard>
        </BentoGrid>
      </div>

      <BottomNav
        items={NAV_ITEMS}
        activeId={tab}
        onSelect={setTab}
        fab={<LaunchFab expanded={sheetOpen} onPress={() => setSheetOpen(true)} />}
      />

      <AnimatePresence>
        {sheetOpen ? (
          <>
            <motion.button
              key="backdrop"
              type="button"
              className="gn-sheet-backdrop"
              aria-label="Fermer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: tokens.motion.duration.base / 1000 }}
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              key="sheet"
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gn-sheet-title"
              tabIndex={-1}
              className="gn-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", ...tokens.motion.spring.snappy }}
            >
              <div className="gn-sheet-head">
                <h2 id="gn-sheet-title" className="gn-section-title">
                  Jouer maintenant
                </h2>
                <button type="button" className="gn-iconbtn" aria-label="Fermer" onClick={() => setSheetOpen(false)}>
                  <CloseIcon width={20} height={20} />
                </button>
              </div>
              <ul className="gn-sheet-options">
                {SHEET_OPTIONS.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className="gn-sheet-option"
                      onClick={() => {
                        setSheetOpen(false);
                        demoNote(`Démo : « ${option.title} » n'est pas encore branché.`);
                      }}
                    >
                      <span className="gn-sheet-option-title">{option.title}</span>
                      <span className="gn-pv-muted">{option.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
