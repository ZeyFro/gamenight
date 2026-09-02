"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useRouter } from "next/navigation";

const PULL_THRESHOLD_PX = 60;
// `router.refresh()` ne retourne pas de promesse — pas moyen de savoir
// précisément quand la revalidation serveur est terminée. Un délai fixe
// suffit largement pour les pages de cette app (requêtes Prisma simples,
// pas de traitement lourd) plutôt que de complexifier avec un vrai
// tracking de fin de streaming.
const REFRESH_SPINNER_MS = 800;

/**
 * Pull-to-refresh mobile léger (Sprint 2, U6) — implémentation maison en
 * touchstart/touchmove/touchend (~50 lignes), pas de lib externe. Ne se
 * déclenche que si le geste commence tout en haut de la page
 * (`window.scrollY === 0`), pour ne jamais interférer avec un scroll
 * normal au milieu d'une longue liste. Pas de `preventDefault` sur le
 * scroll natif : reste un simple indicateur visuel + `router.refresh()`
 * au relâchement, jamais un vrai drag qui bloquerait le geste natif du
 * navigateur.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (refreshing || window.scrollY > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (startY.current === null) return;
    const delta = e.touches[0].clientY - startY.current;
    setPulling(delta > PULL_THRESHOLD_PX);
  }

  function handleTouchEnd() {
    const shouldRefresh = startY.current !== null && pulling;
    startY.current = null;
    setPulling(false);
    if (!shouldRefresh || refreshing) return;

    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), REFRESH_SPINNER_MS);
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {(pulling || refreshing) && (
        <div className="flex items-center justify-center overflow-hidden py-3">
          <div
            aria-hidden
            className={`h-5 w-5 rounded-full border-2 border-border border-t-accent ${
              refreshing ? "animate-spin" : ""
            }`}
          />
        </div>
      )}
      {children}
    </div>
  );
}
