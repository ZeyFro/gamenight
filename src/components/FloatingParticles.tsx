import type { CSSProperties } from "react";

const PARTICLE_COUNT = 10;

/**
 * Positions/délais/durées déterministes (pas de `Math.random()`) — un
 * générateur aléatoire donnerait des valeurs différentes entre le rendu
 * serveur et l'hydratation client (deux passes séparées), ce qui casse
 * l'hydratation. Dérivées de l'index seul, donc identiques des deux
 * côtés, tout en restant visuellement variées (positions/tailles/durées
 * qui ne se répètent pas de façon évidente).
 */
function particleStyle(i: number): CSSProperties {
  const left = (i * 37) % 100;
  const top = (i * 53) % 100;
  const size = 3 + (i % 3);
  const duration = 14 + (i % 4) * 3;
  const delay = i * 1.1;
  const driftX = i % 2 === 0 ? 24 + (i % 3) * 6 : -(24 + (i % 3) * 6);
  const driftY = -(30 + (i % 4) * 8);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: size,
    height: size,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    ["--drift-x" as string]: `${driftX}px`,
    ["--drift-y" as string]: `${driftY}px`,
  };
}

/**
 * Particules flottantes très subtiles derrière le header de la home
 * (design de fond) — CSS pur (`.floating-particle`/`particle-drift` dans
 * `globals.css`), aucune lib. Masquées sur mobile (perf, cf. contrainte
 * "alléger les effets coûteux sur mobile" — 10 éléments animés en continu
 * ont peu d'intérêt visuel sur un petit écran de toute façon).
 */
export function FloatingParticles() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block"
    >
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <span key={i} className="floating-particle" style={particleStyle(i)} />
      ))}
    </div>
  );
}
