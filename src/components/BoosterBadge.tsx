import type { ViewerBoosterState } from "@/lib/booster-profile";
import { BOOSTER_BADGE_LABEL } from "@/lib/boost-perks";

/**
 * Distinction Booster du profil — purement cosmétique.
 *
 * Le composant ne décide de RIEN : il ne s'affiche que pour un état `ACTIVE`
 * déjà vérifié côté serveur par `loadViewerBoosterState`. Un état `UNKNOWN`
 * (Discord muet) n'affiche rien : on préfère l'absence au faux positif.
 * Aucune permission, aucun avantage de jeu n'en découle.
 */
export function BoosterBadge({ state }: { state: ViewerBoosterState }) {
  if (state.kind !== "ACTIVE") return null;
  return (
    <span
      data-booster="active"
      title={`${BOOSTER_BADGE_LABEL} — statut Discord vérifié à l’instant`}
      className="inline-flex items-center gap-1 rounded-full border border-[#b99aff]/70 bg-[#b99aff]/15 px-2 py-0.5 text-[11px] font-medium text-foreground"
    >
      <span aria-hidden="true">💜</span>
      {BOOSTER_BADGE_LABEL}
    </span>
  );
}

/** Anneau lumineux autour de l'avatar, uniquement sur statut vérifié. */
export function boosterRingClass(state: ViewerBoosterState): string {
  return state.kind === "ACTIVE"
    ? "rounded-full bg-[linear-gradient(135deg,#b99aff,#d4ef80)] p-[3px]"
    : "";
}
