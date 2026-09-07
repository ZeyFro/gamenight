"use client";

import { useEffect, useRef, useState, useTransition, type TouchEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SessionBlock } from "@/components/calendar/SessionBlock";
import { ColorDot } from "@/components/ColorDot";
import { ButtonLink } from "@/components/ui/Button";
import { removeOverrideForDate, upsertOverride } from "@/app/disponibilites/actions";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { addDays, buildCalendarHref, type CalendarMode } from "@/lib/calendar-dates";
import { isAvailableAt, type OverrideForDate, type WeeklySlot } from "@/lib/availability";
import { haptics } from "@/lib/haptics";
import { formatDateFr, sameUtcDate, toDateInputValue, wallClockNow } from "@/lib/wallclock";
import type { CalendarDay, CalendarSession, CalendarUser } from "@/lib/calendar";

const HOURS_OF_DAY = Array.from({ length: 24 }, (_, h) => h);
const AUTO_SCROLL_HOUR = 18;
const SWIPE_MIN_DISTANCE_PX = 50;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function bestHourOfDay(day: CalendarDay): number | null {
  let best: { hour: number; count: number } | null = null;
  for (const h of day.hours) {
    if (!best || h.availableUserIds.length > best.count) {
      best = { hour: h.hour, count: h.availableUserIds.length };
    }
  }
  return best && best.count > 0 ? best.hour : null;
}

/**
 * Timeline verticale d'une journée complète (24h, pas de fenêtre
 * réduite) — remplace l'ancien strip horizontal 18h de `WeekGrid`.
 * Auto-scroll vers ~18h à CHAQUE changement de jour (pas juste au tout
 * premier chargement de la page) : le composant est remonté à chaque
 * navigation (`key={date}` posé par la page), donc un simple
 * `useEffect` sans dépendances suffit à relancer le scroll "au
 * chargement" pour chaque nouvelle journée affichée.
 *
 * Swipe géré en `touchstart`/`touchend` natifs (pas `@dnd-kit/core` : sa
 * mécanique item→zone de dépôt ne colle pas à un balayage horizontal sur
 * une colonne qui doit rester scrollable verticalement) — zéro nouvelle
 * dépendance. On ne `preventDefault` jamais le scroll vertical natif, on
 * se contente de mesurer le geste à la fin et de ne naviguer que s'il est
 * nettement plus horizontal que vertical.
 *
 * Édition tactile des dispos (sous-PR 2, étendue post-retour terrain) :
 * `canEdit` (calculé côté page — vrai en Collectif, ou en Individuel sur
 * SA PROPRE dispo, jamais sur celle d'un pote) active un toggle "Modifier
 * mes dispos". Un tap sur une heure crée/retire une
 * `AvailabilityOverride` via les MÊMES server actions que
 * `/disponibilites` (`upsertOverride`/`removeOverrideForDate`) — jamais
 * `WeeklyAvailability`, qui reste éditable uniquement sur `/disponibilites`
 * pour la récurrence. `AvailabilityOverride` n'a qu'une ligne par jour
 * (`@@unique([userId, date])`) : taper une plage différente de
 * l'exception du jour la REMPLACE (toast dédié) plutôt que d'en créer une
 * deuxième — même limite que le formulaire de `/disponibilites`, rien de
 * nouveau introduit ici.
 *
 * Sélection de plage (retour terrain, 1 seul tap était trop lent pour
 * plusieurs heures) : 1er tap sur une heure = ancre "en attente" (opacité
 * réduite), qui reste active INDÉFINIMENT — pas de timeout, l'utilisateur
 * peut prendre son temps. 2e tap = fin de plage → toute la plage
 * [min, max] est basculée et sauvegardée en UN seul `upsertOverride`
 * (respecte la contrainte une-exception-par-jour ci-dessus). Un bouton
 * "Annuler" à côté du message d'attente permet d'abandonner sans taper de
 * 2e heure. Pas de drag/glisser : conflit avec le scroll vertical natif
 * de la timeline sur mobile (déjà écarté pour le swipe jour, même
 * raisonnement). Le sens du bascule (dispo → indispo ou l'inverse) suit
 * l'état actuel de l'heure ancre, appliqué à toute la plage.
 *
 * Édition en vue Collectif (retour terrain) : `canEdit` est maintenant
 * vrai en Collectif aussi — on continue à voir la densité de tout le
 * groupe (le calcul de `blockColor`/`opacityPercent` ne dépend que de
 * `availableUserIds`, jamais de `canEdit`/`editMode`, donc inchangé), et
 * un petit point de la couleur perso (`ownColor`) marque en plus les
 * heures où SA PROPRE dispo est actuellement active — seul signal sinon
 * invisible tant qu'on n'a pas tapé (les blocs des potes restent en
 * lecture seule par construction : la cellule collective n'a jamais été
 * un point d'entrée par-pote).
 *
 * Rendu optimiste : `localOverride` démarre depuis la valeur serveur et
 * se met à jour immédiatement au tap, avant la fin de la sauvegarde en
 * arrière-plan (`startTransition`). Le calcul de dispo par heure passe
 * alors par `isAvailableAt` (même fonction pure que `calendar.ts`/F5,
 * nourrie de `ownWeeklySlots` + `localOverride`) plutôt que par les
 * données du jour envoyées par le serveur — garantit un rendu toujours
 * exact après un tap, y compris pour l'heure "libérée" quand l'exception
 * se déplace, sans avoir besoin d'un re-fetch.
 *
 * Création rapide de soirée (sous-PR 3/3, étendue au Collectif) : hors
 * mode édition dispo, un tap sur une heure SANS session propose "Créer
 * une soirée ici ?" (bottom-sheet, un seul `Dialog` partagé plutôt qu'une
 * instance par heure) — en Individuel comme en Collectif. Le mode édition
 * reste dédié aux dispos ; la création de soirée est l'action par défaut
 * d'un tap sur une heure libre quand ce mode est désactivé, dans les deux
 * vues. En Individuel, disponible sur n'importe quel profil affiché — pas
 * que le sien — repérer un créneau libre chez un pote puis y caler une
 * soirée est un usage voulu. Redirige vers `/sessions` (le formulaire de
 * création y est déjà inline) avec `?date=&time=` préremplis — aucun
 * nouveau formulaire, aucune nouvelle server action.
 */
export function DayTimeline({
  day,
  users,
  mode,
  selectedUserId,
  date,
  today,
  pote,
  potes,
  canEdit,
  ownWeeklySlots,
  ownOverrideForDay,
  ownColor,
}: {
  day: CalendarDay;
  users: CalendarUser[];
  mode: CalendarMode;
  selectedUserId?: string;
  date: Date;
  today: Date;
  pote?: string;
  potes?: string;
  /** SA PROPRE dispo — jamais vrai pour la dispo d'un pote. */
  canEdit?: boolean;
  ownWeeklySlots?: WeeklySlot[];
  ownOverrideForDay?: OverrideForDate | null;
  /** Couleur perso de l'utilisateur connecté — marque ses propres heures dispo en édition Collectif. */
  ownColor?: string;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const totalUsers = users.length;
  const usersById = new Map(users.map((u) => [u.id, u]));
  const selectedUserColor =
    mode === "individuel" && selectedUserId
      ? (usersById.get(selectedUserId)?.color ?? "var(--accent)")
      : undefined;

  const [editMode, setEditMode] = useState(false);
  const [localOverride, setLocalOverride] = useState<OverrideForDate | null>(
    ownOverrideForDay ?? null
  );
  const [createPromptHour, setCreatePromptHour] = useState<number | null>(null);
  const [avatarSheetHour, setAvatarSheetHour] = useState<number | null>(null);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const pendingStartRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  function clearPendingRange() {
    pendingStartRef.current = null;
    setPendingStart(null);
  }

  const isToday = sameUtcDate(date, today);

  // Amélioration calendrier — ligne "maintenant" façon Outlook/Google
  // Calendar. `null` tant que l'effet n'a pas tourné (jamais calculé
  // pendant le rendu initial, serveur ou client) : évite tout risque de
  // léger décalage d'hydratation entre le rendu serveur et le premier
  // rendu client si les deux tombent de part et d'autre d'une frontière
  // de minute — la ligne apparaît juste une frame plus tard, sans
  // conséquence visuelle. `wallClockNow()` (pas `new Date()`) pour rester
  // sur l'horloge murale Paris du reste du fichier (`getUTCHours()` sur
  // les dates de session, etc.), pas le fuseau local du navigateur.
  const [nowClock, setNowClock] = useState<{ hour: number; minute: number } | null>(() => {
    if (!isToday) return null;
    const wallNow = wallClockNow();
    return { hour: wallNow.getUTCHours(), minute: wallNow.getUTCMinutes() };
  });
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => {
      const wallNow = wallClockNow();
      setNowClock({ hour: wallNow.getUTCHours(), minute: wallNow.getUTCMinutes() });
    }, 60_000);
    return () => clearInterval(interval);
  }, [isToday]);
  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const prevHref = buildCalendarHref({ date: toDateInputValue(prevDate), mode, pote, potes });
  const nextHref = buildCalendarHref({ date: toDateInputValue(nextDate), mode, pote, potes });
  const todayHref = buildCalendarHref({ mode, pote, potes });

  const bestHour = mode === "collectif" ? bestHourOfDay(day) : null;

  const sessionsByHour = new Map<number, CalendarSession[]>();
  for (const session of day.sessions) {
    const hour = session.date.getUTCHours();
    const list = sessionsByHour.get(hour) ?? [];
    list.push(session);
    sessionsByHour.set(hour, list);
  }

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

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

    router.push(deltaX < 0 ? nextHref : prevHref);
  }

  function applyOverrideRange(startHour: number, endHourInclusive: number) {
    const lo = Math.min(startHour, endHourInclusive);
    const hi = Math.max(startHour, endHourInclusive);
    const hourStart = `${pad2(lo)}:00`;
    const hourEnd = `${pad2((hi + 1) % 24)}:00`;
    const isExactlyThisOverride =
      localOverride && localOverride.startTime === hourStart && localOverride.endTime === hourEnd;

    if (isExactlyThisOverride) {
      const previousOverride = localOverride;
      setLocalOverride(null);
      startTransition(async () => {
        const fd = new FormData();
        fd.set("date", toDateInputValue(date));
        const result = await removeOverrideForDate(fd);
        if (!result.ok) {
          setLocalOverride(previousOverride);
          toast.error(
            result.error === RATE_LIMIT_ERROR_KEY
              ? RATE_LIMIT_MESSAGE
              : "Une erreur est survenue."
          );
          return;
        }
        toast.success("Exception supprimée — retour au planning habituel");
      });
      return;
    }

    const hadOverrideElsewhere = localOverride !== null;
    // Le sens du bascule suit l'état actuel de l'heure ancre (`lo`),
    // appliqué à toute la plage — cohérent avec le comportement 1h
    // d'origine, pas de logique de "majorité" à inventer.
    const instant = new Date(date);
    instant.setUTCHours(lo, 0, 0, 0);
    const currentlyAvailable = isAvailableAt(instant, ownWeeklySlots ?? [], localOverride ?? undefined);
    const nextAvailable = !currentlyAvailable;

    const previousOverride = localOverride;
    setLocalOverride({ available: nextAvailable, startTime: hourStart, endTime: hourEnd });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("date", toDateInputValue(date));
      fd.set("available", String(nextAvailable));
      fd.set("startTime", hourStart);
      fd.set("endTime", hourEnd);
      const result = await upsertOverride(fd);
      if (!result.ok) {
        setLocalOverride(previousOverride);
        toast.error(
          result.error === RATE_LIMIT_ERROR_KEY
            ? RATE_LIMIT_MESSAGE
            : "Une erreur est survenue."
        );
        return;
      }
      const rangeLabel = lo === hi ? "" : ` (${pad2(lo)}h–${pad2((hi + 1) % 24)}h)`;
      toast.success(
        hadOverrideElsewhere
          ? `Exception remplacée${rangeLabel}`
          : nextAvailable
            ? `Dispo ajoutée${rangeLabel}`
            : `Indispo ajoutée${rangeLabel}`
      );
    });
  }

  /**
   * 1er tap = pose l'ancre "en attente" (reste active jusqu'au 2e tap ou
   * à "Annuler", pas de délai). 2e tap = fin de plage, bascule
   * [ancre, hour] en un seul appel.
   */
  function handleTapHour(hour: number) {
    if (!canEdit || !editMode) return;
    haptics.light();

    const anchor = pendingStartRef.current;
    if (anchor === null) {
      pendingStartRef.current = hour;
      setPendingStart(hour);
      return;
    }

    clearPendingRange();
    applyOverrideRange(anchor, hour);
  }

  function handleTapEmptyHour(hour: number) {
    if (editMode) return;
    setCreatePromptHour(hour);
  }

  const createSessionHref =
    createPromptHour !== null
      ? `/sessions?date=${toDateInputValue(date)}&time=${pad2(createPromptHour)}:00`
      : null;

  const avatarSheetIds =
    avatarSheetHour !== null
      ? (day.hours.find((h) => h.hour === avatarSheetHour)?.availableUserIds ?? [])
      : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={prevHref}
          aria-label="Jour précédent"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ‹
        </Link>
        <div className="flex flex-col items-center">
          <p className="text-sm font-medium capitalize text-foreground">{formatDateFr(date)}</p>
          {!isToday && (
            <Link href={todayHref} className="text-xs text-accent hover:underline">
              Aujourd&apos;hui
            </Link>
          )}
        </div>
        <Link
          href={nextHref}
          aria-label="Jour suivant"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ›
        </Link>
      </div>

      {canEdit && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearPendingRange();
                setEditMode((v) => !v);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                editMode
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {editMode
                ? pendingStart !== null
                  ? "⏳ Tape la fin de la plage…"
                  : "✅ Édition activée — tape un créneau (ou 2 pour une plage)"
                : "✏️ Modifier mes dispos"}
            </button>
            {pendingStart !== null && (
              <button
                type="button"
                onClick={clearPendingRange}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Annuler
              </button>
            )}
          </div>
          {localOverride && <span className="text-xs text-muted">📌 Exception ce jour</span>}
        </div>
      )}

      {mode === "collectif" && day.maxAvailableCount === 0 && day.sessions.length === 0 && (
        <p className="text-sm text-muted">Personne n&apos;a indiqué de dispo ce jour-là.</p>
      )}

      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex max-h-[65vh] flex-col overflow-y-auto rounded-xl border border-border bg-surface"
      >
        {HOURS_OF_DAY.map((hour) => {
          const hourData = day.hours.find((h) => h.hour === hour);
          const availableIds = hourData?.availableUserIds ?? [];

          let isAvailable: boolean;
          if (canEdit) {
            const instant = new Date(date);
            instant.setUTCHours(hour, 0, 0, 0);
            isAvailable = isAvailableAt(instant, ownWeeklySlots ?? [], localOverride ?? undefined);
          } else {
            isAvailable =
              mode === "individuel"
                ? !!selectedUserId && availableIds.includes(selectedUserId)
                : availableIds.length > 0;
          }

          const sessionsAtHour = sessionsByHour.get(hour) ?? [];
          const isBestHour = bestHour === hour;

          // Couleur du bloc (PR propagation User.color) : en individuel
          // uniquement, toujours la couleur du pote affiché — remplit tout
          // le créneau (un seul utilisateur possible, pas de lisibilité en
          // jeu). En collectif, plus AUCUN remplissage de fond coloré
          // (FIX2, retours visuels post-Sprint2) : le fond violet/jaune
          // intense derrière les créneaux rendait la vue chargée et peu
          // lisible d'un coup d'œil. Le fond reste neutre
          // (`var(--surface-hover)`, cf. `cellStyle` plus bas) — seules les
          // petites pastilles de couleur par pote (`showAvailabilityDots`)
          // portent l'info de qui est dispo.
          let blockColor: string | undefined;
          const opacityPercent = 100;
          if (mode === "individuel" && isAvailable) {
            blockColor = selectedUserColor;
          }

          const title =
            mode === "individuel"
              ? isAvailable
                ? "Dispo"
                : "Pas dispo"
              : `${availableIds.length}/${totalUsers} dispo${availableIds.length > 1 ? "s" : ""}`;
          const editable = canEdit && editMode;
          const isPendingAnchor = editable && pendingStart === hour;
          // En Collectif + édition, la cellule garde la couleur/densité
          // collective (inchangée, cf. `blockColor` ci-dessus) — un petit
          // point de la couleur perso marque en plus SA PROPRE dispo,
          // seul signal sinon invisible tant qu'on n'a pas tapé.
          const showOwnDot = editable && mode === "collectif" && isAvailable && !!ownColor;
          // Ronds de couleur perso par pote dispo (retour terrain "qui est
          // dispo ?" pas visible d'un coup d'œil en vue Collectif) — prend
          // le pas sur le tap "créer une soirée" quand 2+ potes sont
          // dispo sur ce créneau : voir qui est libre est plus utile ici
          // qu'un raccourci de création, qui reste inchangé pour 0/1 pote.
          const showAvailabilityDots = mode === "collectif" && !editable && availableIds.length >= 2;
          const canPromptCreate = !editMode && !showAvailabilityDots && sessionsAtHour.length === 0;
          const cellClassName = `h-7 rounded-md transition-transform ${
            isBestHour ? "ring-2 ring-accent" : ""
          } ${editable || canPromptCreate ? "active:scale-95" : ""} ${
            isPendingAnchor ? "opacity-60" : ""
          }`;
          const cellStyle = {
            backgroundColor: blockColor
              ? `color-mix(in srgb, ${blockColor} ${opacityPercent}%, transparent)`
              : "var(--surface-hover)",
          };

          const isCurrentHour = nowClock !== null && nowClock.hour === hour;

          return (
            <div
              key={hour}
              ref={hour === AUTO_SCROLL_HOUR ? highlightRef : undefined}
              className={`relative flex items-start gap-2 border-t border-border/60 px-3 py-1.5 first:border-t-0 ${
                isCurrentHour ? "bg-accent/5" : ""
              }`}
            >
              {isCurrentHour && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                  style={{ top: `${(nowClock.minute / 60) * 100}%` }}
                >
                  <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                  <span className="h-px flex-1 bg-orange-500" />
                </div>
              )}
              <span className="w-9 shrink-0 pt-1.5 text-right text-[11px] text-faint">
                {String(hour).padStart(2, "0")}h
              </span>
              <div className="flex flex-1 flex-col gap-1">
                {editable ? (
                  <button
                    type="button"
                    onClick={() => handleTapHour(hour)}
                    aria-label={
                      isPendingAnchor
                        ? `${pad2(hour)}h — début de plage sélectionné, tape la fin`
                        : `${pad2(hour)}h — ${isAvailable ? "dispo, taper pour retirer" : "pas dispo, taper pour ajouter"}`
                    }
                    title={title}
                    className={`${cellClassName} relative w-full border ${
                      isPendingAnchor ? "border-dashed border-accent" : "border-dashed border-accent/40"
                    }`}
                    style={cellStyle}
                  >
                    {showOwnDot && (
                      <span
                        className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: ownColor }}
                      />
                    )}
                  </button>
                ) : showAvailabilityDots ? (
                  <button
                    type="button"
                    onClick={() => setAvatarSheetHour(hour)}
                    aria-label={`${pad2(hour)}h — ${availableIds.length} potes dispo, taper pour voir qui`}
                    title={title}
                    className={`${cellClassName} relative w-full`}
                    style={cellStyle}
                  >
                    <span className="absolute inset-0 flex items-center gap-1 px-1.5">
                      {availableIds.slice(0, availableIds.length > 5 ? 4 : 5).map((id) => (
                        <ColorDot
                          key={id}
                          color={usersById.get(id)?.color ?? "var(--accent)"}
                          size={16}
                        />
                      ))}
                      {availableIds.length > 5 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-[9px] font-semibold text-foreground ring-2 ring-surface">
                          +{availableIds.length - 4}
                        </span>
                      )}
                    </span>
                  </button>
                ) : canPromptCreate ? (
                  <button
                    type="button"
                    onClick={() => handleTapEmptyHour(hour)}
                    aria-label={`${pad2(hour)}h — créer une soirée à cette heure`}
                    title={title}
                    className={`${cellClassName} w-full`}
                    style={cellStyle}
                  />
                ) : (
                  <div title={title} className={cellClassName} style={cellStyle} />
                )}
                {sessionsAtHour.map((session) => (
                  <SessionBlock key={session.id} session={session} />
                ))}
              </div>
              {isBestHour && <span className="pt-1.5 text-sm">✨</span>}
            </div>
          );
        })}
      </div>

      <Dialog.Root
        open={createPromptHour !== null}
        onOpenChange={(next) => !next && setCreatePromptHour(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
          <Dialog.Content asChild aria-describedby={undefined}>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
            >
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Créer une soirée ici ?
              </Dialog.Title>
              {createPromptHour !== null && (
                <p className="mt-2 text-sm text-muted">
                  {formatDateFr(date)} à {pad2(createPromptHour)}h00
                </p>
              )}
              <div className="mt-5 flex gap-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-border px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
                  >
                    Annuler
                  </button>
                </Dialog.Close>
                {createSessionHref && (
                  <Dialog.Close asChild>
                    <ButtonLink href={createSessionHref} variant="primary" className="flex-1">
                      Créer
                    </ButtonLink>
                  </Dialog.Close>
                )}
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={avatarSheetHour !== null}
        onOpenChange={(next) => !next && setAvatarSheetHour(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
          <Dialog.Content asChild aria-describedby={undefined}>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
            >
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {avatarSheetHour !== null ? `Dispo à ${pad2(avatarSheetHour)}h` : "Dispo"}
              </Dialog.Title>
              <ul className="mt-3 flex flex-col gap-2">
                {avatarSheetIds.map((id) => {
                  const u = usersById.get(id);
                  if (!u) return null;
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm text-foreground">
                      <ColorDot color={u.color} size={12} />
                      {u.discordName}
                    </li>
                  );
                })}
              </ul>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mt-5 w-full rounded-lg border border-border px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Fermer
                </button>
              </Dialog.Close>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {mode === "collectif" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted">
          {users.map((user) => (
            <span key={user.id} className="flex items-center gap-1.5">
              <ColorDot color={user.color} size={8} />
              {user.discordName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
