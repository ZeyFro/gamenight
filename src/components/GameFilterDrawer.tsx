"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  DEFAULT_GAME_FILTERS,
  GAME_MODES,
  GAME_MODE_LABELS,
  GAME_SOURCES,
  GAME_SOURCE_LABELS,
  OWNERSHIP_SOURCES,
  OWNERSHIP_SOURCE_LABELS,
  PLAYERS_RANGE,
  RELEASE_YEAR_RANGE,
  countActiveFilters,
  parseGameFilters,
  serializeGameFilters,
  type GameFilters,
  type GameMode,
} from "@/lib/game-filters";
import type { GameSource, UserGameSource } from "@prisma/client";

/**
 * Bug UX corrigé (remonté en prod, PR 32 2.5/4) : 2 `<input type="range">`
 * empilés sur la même piste étaient difficiles à manipuler au tactile
 * (les deux poignées se chevauchent, pas de séparation visuelle, un tap
 * au milieu peut saisir la mauvaise poignée) — remplacés par 2
 * `<select>` natifs (fallback suggéré à la demande), fiables au tactile
 * comme au clavier, sélection exacte à chaque fois. Contrairement aux
 * sliders "Nombre de joueurs" (pas remontés comme buggés, non touchés ici
 * — non-régression).
 */
const RELEASE_YEARS = Array.from(
  { length: RELEASE_YEAR_RANGE.max - RELEASE_YEAR_RANGE.min + 1 },
  (_, i) => RELEASE_YEAR_RANGE.min + i
);

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-background text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Panneau de filtres bibliothèque (PR 31, 2/4 — Bloc B), partagé entre
 * `/bibliotheque`, `/bibliotheque/groupe` et `/tierlist`. Un seul
 * composant Radix Dialog responsive (bottom-sheet mobile ↔ panneau
 * ancré à droite en desktop via les breakpoints `sm:`) plutôt que deux
 * mécaniques distinctes (drawer latéral desktop + geste de swipe mobile
 * "from scratch") — réutilise le pattern déjà établi ailleurs dans
 * l'app (`VoterAvatars`, `EditGameDialog`…), cohérent visuellement et
 * beaucoup plus robuste qu'un vrai geste de swipe à construire from
 * scratch pour un gain marginal. Ouverture au tap du bouton "Filtres"
 * sur les deux formats.
 *
 * Chaque filtre écrit son état dans l'URL immédiatement (pas de bouton
 * "Appliquer") via `router.replace` — `scroll: false` pour ne pas sauter
 * en haut de page à chaque changement. Les sliders utilisent l'event
 * `onChange` natif d'`<input type="range">` (déclenché au relâchement,
 * pas en continu pendant le drag) : pas de flot de navigations pendant
 * qu'on glisse, sans avoir besoin d'un debounce applicatif.
 */
export function GameFilterDrawer({
  availableGenres,
  maxOwners,
  personal = false,
}: {
  availableGenres: string[];
  maxOwners: number;
  /** N'affiche le filtre "Provenance" que sur `/bibliotheque` (biblio perso) — voir `OWNERSHIP_SOURCES` dans `src/lib/game-filters.ts`. */
  personal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const filters = useMemo(
    () => parseGameFilters(Object.fromEntries(searchParams.entries())),
    [searchParams]
  );
  const activeCount = countActiveFilters(filters);

  function update(next: GameFilters) {
    const qs = serializeGameFilters(next);
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function toggleMode(mode: GameMode) {
    update({
      ...filters,
      modes: filters.modes.includes(mode)
        ? filters.modes.filter((m) => m !== mode)
        : [...filters.modes, mode],
    });
  }

  function toggleSource(source: GameSource) {
    update({
      ...filters,
      sources: filters.sources.includes(source)
        ? filters.sources.filter((s) => s !== source)
        : [...filters.sources, source],
    });
  }

  function toggleOwnership(source: UserGameSource) {
    update({
      ...filters,
      ownership: filters.ownership.includes(source)
        ? filters.ownership.filter((s) => s !== source)
        : [...filters.ownership, source],
    });
  }

  function toggleGenre(genre: string) {
    update({
      ...filters,
      genres: filters.genres.includes(genre)
        ? filters.genres.filter((g) => g !== genre)
        : [...filters.genres, genre],
    });
  }

  function reset() {
    update(DEFAULT_GAME_FILTERS);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" size="sm" className="gap-2">
          Filtres
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-full sm:max-w-sm sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:p-6"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Filtres
              </Dialog.Title>
              <button
                type="button"
                onClick={reset}
                className="text-sm text-accent hover:underline"
              >
                Réinitialiser
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-6">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-muted">Modes de jeu</legend>
                <div className="flex flex-wrap gap-2">
                  {GAME_MODES.map((mode) => (
                    <ToggleChip
                      key={mode}
                      active={filters.modes.includes(mode)}
                      onClick={() => toggleMode(mode)}
                    >
                      {GAME_MODE_LABELS[mode]}
                    </ToggleChip>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-muted">
                  Nombre de joueurs — {filters.playersMin} à {filters.playersMax}
                </legend>
                <div className="flex flex-col gap-2">
                  <input
                    type="range"
                    min={PLAYERS_RANGE.min}
                    max={PLAYERS_RANGE.max}
                    value={filters.playersMin}
                    aria-label="Nombre de joueurs minimum"
                    onChange={(e) => {
                      const min = Number(e.target.value);
                      update({
                        ...filters,
                        playersMin: min,
                        playersMax: Math.max(min, filters.playersMax),
                      });
                    }}
                    className="w-full accent-accent"
                  />
                  <input
                    type="range"
                    min={PLAYERS_RANGE.min}
                    max={PLAYERS_RANGE.max}
                    value={filters.playersMax}
                    aria-label="Nombre de joueurs maximum"
                    onChange={(e) => {
                      const max = Number(e.target.value);
                      update({
                        ...filters,
                        playersMax: max,
                        playersMin: Math.min(max, filters.playersMin),
                      });
                    }}
                    className="w-full accent-accent"
                  />
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-muted">Source</legend>
                <div className="flex flex-wrap gap-2">
                  {GAME_SOURCES.map((source) => (
                    <ToggleChip
                      key={source}
                      active={filters.sources.includes(source)}
                      onClick={() => toggleSource(source)}
                    >
                      {GAME_SOURCE_LABELS[source]}
                    </ToggleChip>
                  ))}
                </div>
              </fieldset>

              {personal && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs font-medium text-muted">
                    Provenance dans ta bibliothèque
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {OWNERSHIP_SOURCES.map((source) => (
                      <ToggleChip
                        key={source}
                        active={filters.ownership.includes(source)}
                        onClick={() => toggleOwnership(source)}
                      >
                        {OWNERSHIP_SOURCE_LABELS[source]}
                      </ToggleChip>
                    ))}
                  </div>
                </fieldset>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-muted">
                  Possédé par au moins {filters.ownedMin} pote
                  {filters.ownedMin > 1 ? "s" : ""}
                </legend>
                <input
                  type="range"
                  min={1}
                  max={Math.max(2, maxOwners)}
                  value={filters.ownedMin}
                  aria-label="Possédé par au moins N potes"
                  onChange={(e) => update({ ...filters, ownedMin: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
              </fieldset>

              {availableGenres.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs font-medium text-muted">Genre</legend>
                  <div className="flex flex-wrap gap-2">
                    {availableGenres.map((genre) => (
                      <ToggleChip
                        key={genre}
                        active={filters.genres.includes(genre)}
                        onClick={() => toggleGenre(genre)}
                      >
                        {genre}
                      </ToggleChip>
                    ))}
                  </div>
                  <p className="text-xs text-faint">
                    Un jeu dont la fiche n&apos;a jamais été ouverte n&apos;a pas
                    encore ses genres IGDB en cache — il n&apos;apparaît pas ici
                    tant qu&apos;il n&apos;est pas enrichi.
                  </p>
                </fieldset>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-muted">
                  Date de sortie
                </legend>
                <div className="flex items-center gap-2">
                  <select
                    value={filters.yearMin}
                    aria-label="Année de sortie minimum"
                    onChange={(e) => {
                      const min = Number(e.target.value);
                      update({
                        ...filters,
                        yearMin: min,
                        yearMax: Math.max(min, filters.yearMax),
                      });
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    {RELEASE_YEARS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0 text-sm text-muted">à</span>
                  <select
                    value={filters.yearMax}
                    aria-label="Année de sortie maximum"
                    onChange={(e) => {
                      const max = Number(e.target.value);
                      update({
                        ...filters,
                        yearMax: max,
                        yearMin: Math.min(max, filters.yearMin),
                      });
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    {RELEASE_YEARS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-faint">
                  Même limite que pour le Genre : nécessite la fiche IGDB du jeu déjà en cache.
                </p>
              </fieldset>
            </div>

            <Dialog.Close asChild>
              <Button type="button" variant="primary" fullWidthOnMobile className="mt-6 w-full">
                Voir les résultats
              </Button>
            </Dialog.Close>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
