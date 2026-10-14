"use client";

import { useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import Link from "next/link";
import type { NotificationType } from "@prisma/client";
import { markAllNotificationsReadAction } from "@/app/notifications-actions";
import { formatDurationFr } from "@/lib/wallclock";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAtIso: string;
  href: string | null;
  /** > 1 pour une ligne regroupée (ex. "5 récompenses pour la soirée X"). */
  count: number;
}

const TYPE_ICONS: Record<NotificationType, string> = {
  LEVEL_UP: "🎉",
  BADGE: "🏅",
  SESSION_RESULT: "🎮",
  SESSION_CREATED: "📣",
  REMINDER: "⏰",
  REVANCHE: "🔄",
  ACHIEVEMENT: "🏅",
  PRONOSTIC: "🔮",
  XP_BET: "🎲",
  SUPERLATIVE_AWARD: "🏆",
  DEBT: "💀",
  INSTANT_SESSION_INVITE: "🎮",
};

/**
 * Pastille de couleur par type (Amélioration des features existantes,
 * PR-B, item 4) — violet=level up, orange=tout ce qui touche une soirée
 * (résultats, création, rappel, revanche, achievement, pronostic, pari,
 * récompense), vert=badge, rouge=dette. Un simple point à côté de l'icône
 * (déjà distinctive par emoji) plutôt qu'un recoloriage complet de la
 * ligne, pour rester lisible sur les notifs déjà lues (fond neutre).
 */
const TYPE_DOT_COLORS: Record<NotificationType, string> = {
  LEVEL_UP: "bg-accent",
  BADGE: "bg-emerald-500",
  DEBT: "bg-destructive",
  SESSION_RESULT: "bg-orange-500",
  SESSION_CREATED: "bg-orange-500",
  REMINDER: "bg-orange-500",
  REVANCHE: "bg-orange-500",
  ACHIEVEMENT: "bg-orange-500",
  PRONOSTIC: "bg-orange-500",
  XP_BET: "bg-orange-500",
  SUPERLATIVE_AWARD: "bg-orange-500",
  INSTANT_SESSION_INVITE: "bg-orange-500",
};

/**
 * Cloche de notifications in-app (Sprint 2 PR-C, U3) — même pattern
 * bottom-sheet Radix `Dialog` que le reste de l'app (création de soirée
 * sur le calendrier, liste des votants) plutôt qu'un vrai dropdown : pas
 * de nouvelle dépendance, cohérent visuellement mobile/desktop.
 *
 * Marquage lu : à l'ouverture du panneau (toutes les notifications
 * visibles passent lues d'un coup — pas de tracking fin par ligne, cf.
 * énoncé "marquées lues au scroll/ouverture") ET via le bouton "Tout
 * marquer comme lu" (redondant avec l'ouverture mais explicitement
 * demandé, reste un no-op silencieux si déjà tout lu).
 */
export function NotificationBell({
  initialUnreadCount,
  notifications,
}: {
  initialUnreadCount: number;
  notifications: NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();
  // `Date.now()` ne peut pas être appelé pendant le rendu (impur) —
  // capturé dans le handler d'ouverture (événement, pas un effet) plutôt
  // que lu directement dans le JSX ci-dessous.
  const [now, setNow] = useState<number | null>(null);

  function markAllRead() {
    if (unreadCount === 0) return;
    setUnreadCount(0);
    startTransition(() => {
      markAllNotificationsReadAction();
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNow(Date.now());
          markAllRead();
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-foreground transition-colors hover:bg-surface-hover"
        >
          🔔
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col gap-3 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-16 sm:right-6 sm:bottom-auto sm:w-96 sm:rounded-2xl sm:border sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Notifications
              </Dialog.Title>
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-accent hover:underline"
              >
                Tout marquer comme lu
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  Aucune notification pour l&apos;instant.
                </p>
              ) : (
                notifications.map((n) => {
                  const ago =
                    now !== null
                      ? formatDurationFr(now - new Date(n.createdAtIso).getTime())
                      : null;
                  const row = (
                    <div
                      className={`flex items-start gap-3 rounded-lg p-3 transition-colors ${
                        n.read ? "" : "bg-accent/10"
                      } ${n.href ? "hover:bg-surface-hover" : ""}`}
                    >
                      <span className="relative shrink-0 text-xl" aria-hidden>
                        {TYPE_ICONS[n.type]}
                        <span
                          className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${TYPE_DOT_COLORS[n.type]}`}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {n.title}
                          {n.count > 1 && (
                            <span className="ml-1.5 rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                              ×{n.count}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted">{n.message}</p>
                      </div>
                      {ago && (
                        <span className="shrink-0 text-[10px] text-faint">il y a {ago}</span>
                      )}
                    </div>
                  );
                  return n.href ? (
                    <Link key={n.id} href={n.href} onClick={() => setOpen(false)}>
                      {row}
                    </Link>
                  ) : (
                    <div key={n.id}>{row}</div>
                  );
                })
              )}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
