import type { ReactNode } from "react";
import type { ProfilePresentation } from "@/lib/profile-customization";

/**
 * Rendu de la personnalisation du profil : composants de présentation, CSS seul (voir
 * src/app/profile-cosmetics.css), aucun JS côté navigateur. Les classes viennent uniquement des
 * identifiants du catalogue (`pc-<id>`), jamais d'une valeur libre.
 *
 * Accessibilité : le pseudo reste un texte réel (lecteurs d'écran, sélection, contraste vérifié
 * par test) ; les cadres, bannières et couches d'effets sont décoratifs (`aria-hidden`) ; aucune
 * information n'est portée par la couleur seule (le titre et les badges de la vitrine sont du texte).
 * `data-pc-effects="off"` (préférence du spectateur) et `prefers-reduced-motion` coupent les animations.
 */

const LAYER_EFFECTS = new Set(["fx-flames", "fx-flames-ranker", "fx-sparkles"]);

export function ProfileCosmeticsRoot({
  view,
  children,
  className = "",
}: {
  view: ProfilePresentation | null;
  children: ReactNode;
  className?: string;
}) {
  if (!view) return <div className={className || undefined}>{children}</div>;
  const classes = [
    "pc-root",
    view.cardTheme ? `pc-card pc-${view.cardTheme.id}` : "",
    view.effect ? `pc-${view.effect.id}` : "",
    view.entrance ? `pc-${view.entrance.id}` : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={classes} data-pc-effects={view.effectsEnabled ? "on" : "off"}>
      {view.effect && LAYER_EFFECTS.has(view.effect.id) && <span aria-hidden className="pc-layer" />}
      {children}
    </div>
  );
}

export function StyledName({ name, view }: { name: string; view: ProfilePresentation | null }) {
  // Sans style de pseudo ni brillance : texte brut, rendu identique à l'existant.
  if (!view?.nameStyle && view?.effect?.id !== "fx-shine") return <>{name}</>;
  return <span className={`pc-name${view.nameStyle ? ` pc-${view.nameStyle.id}` : ""}`}>{name}</span>;
}

export function ProfileBanner({ view, tall = false }: { view: ProfilePresentation | null; tall?: boolean }) {
  if (!view?.bannerFx) return null;
  return <div aria-hidden className={`pc-banner mt-2 pc-${view.bannerFx.id}${tall ? " pc-banner-tall" : ""}`} />;
}

export function ProfileTitle({ view }: { view: ProfilePresentation | null }) {
  if (!view?.title) return null;
  return <span className="pc-title">{view.title.name}</span>;
}

export function BadgeShowcase({ view }: { view: ProfilePresentation | null }) {
  if (!view || view.showcase.length === 0) return null;
  return (
    <section aria-label="Vitrine de badges" className="mt-3">
      <ul className="pc-showcase">
        {view.showcase.map((badge) => (
          <li key={badge.id}>
            <span aria-hidden>{badge.icon}</span>
            <span>{badge.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
