"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import confetti from "canvas-confetti";

const CELEBRATE_KINDS = new Set(["levelup", "badge", "win"]);

/**
 * Confettis de célébration (Sprint 2 PR-B, U9) — déclenchés par
 * `?celebrate=levelup|badge|win` sur n'importe quelle page (une
 * redirection serveur pose ce paramètre après un level up, un badge
 * débloqué ou une victoire de soirée). Monté une seule fois dans le
 * layout racine plutôt que dupliqué par page déclenchante : le paramètre
 * peut atterrir sur des pages différentes selon d'où vient l'action.
 *
 * Tiré une seule fois : `useEffect` avec `searchParams` en dépendance,
 * mais le nettoyage immédiat du paramètre via `history.replaceState`
 * (jamais `router.replace`, qui redéclenche un re-render Next inutile
 * pour un simple nettoyage d'URL) fait qu'une deuxième exécution de
 * l'effet ne retrouve plus le paramètre — pas de flag `useRef` requis.
 */
export function CelebrationConfetti() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const celebrate = searchParams.get("celebrate");
    if (!celebrate || !CELEBRATE_KINDS.has(celebrate)) return;

    confetti({
      particleCount: 140,
      spread: 75,
      origin: { y: 0.6 },
      colors: ["#8b5cf6", "#a78bfa", "#facc15", "#f8fafc"],
    });

    const url = new URL(window.location.href);
    url.searchParams.delete("celebrate");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams]);

  return null;
}
