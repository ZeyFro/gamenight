import { tokens, type Gradient, type Shadow } from "./tokens";

/**
 * Traduction web des jetons (`tokens.ts`, neutres) en variables CSS
 * `--gn-*`. Seule cette couche connaît le CSS ; `tokens.ts` reste
 * réutilisable tel quel dans Expo. Le fichier `tokens.css` est GÉNÉRÉ
 * depuis ici (voir `tokens.test.ts`, qui échoue s'il est périmé).
 */

const px = (n: number): string => `${n}px`;
const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export function toLinearGradient(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(", ");
  return `linear-gradient(${g.angle}deg, ${stops})`;
}

export function toBoxShadow(shadow: Shadow): string {
  return shadow.layers.map((l) => `${px(l.x)} ${px(l.y)} ${px(l.blur)} ${px(l.spread)} ${l.color}`).join(", ");
}

export function toCubicBezier(points: readonly number[]): string {
  return `cubic-bezier(${points.join(", ")})`;
}

const FONT_STACKS: Record<string, string> = {
  sans: "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** Toutes les variables `--gn-*`, dans un ordre stable. */
export function toCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  const add = (name: string, value: string | number): void => {
    vars[`--gn-${name}`] = String(value);
  };

  for (const [group, shades] of Object.entries(tokens.colors)) {
    for (const [shade, value] of Object.entries(shades)) add(`color-${kebab(group)}-${kebab(shade)}`, value);
  }
  for (const [name, g] of Object.entries(tokens.gradients)) add(`gradient-${name}`, toLinearGradient(g));
  for (const [name, v] of Object.entries(tokens.spacing)) add(`space-${name}`, px(v));
  for (const [name, v] of Object.entries(tokens.radii)) add(`radius-${name}`, px(v));
  for (const [name, s] of Object.entries(tokens.shadows)) add(`shadow-${kebab(name)}`, toBoxShadow(s));

  const { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } = tokens.typography;
  for (const name of Object.keys(fontFamily)) add(`font-family-${name}`, FONT_STACKS[name]);
  for (const [name, v] of Object.entries(fontSize)) add(`font-size-${name}`, px(v));
  for (const [name, v] of Object.entries(fontWeight)) add(`font-weight-${name}`, v);
  for (const [name, v] of Object.entries(lineHeight)) add(`line-height-${name}`, v);
  for (const [name, v] of Object.entries(letterSpacing)) add(`letter-spacing-${name}`, px(v));

  for (const [name, v] of Object.entries(tokens.motion.duration)) add(`duration-${name}`, `${v}ms`);
  for (const [name, v] of Object.entries(tokens.motion.easing)) add(`easing-${name}`, toCubicBezier(v));

  for (const [name, v] of Object.entries(tokens.layout)) add(`layout-${kebab(name)}`, px(v));
  for (const [name, v] of Object.entries(tokens.zIndex)) add(`z-${name}`, v);

  return vars;
}

/** Contenu de `tokens.css` : variables scopées à `selector` (jamais `:root`, pour ne rien changer ailleurs). */
export function renderTokensCss(selector = ".gn-design"): string {
  const lines = Object.entries(toCssVariables()).map(([name, value]) => `  ${name}: ${value};`);
  return [
    "/*",
    " * GÉNÉRÉ depuis src/design/tokens.ts — ne pas éditer à la main.",
    " * Régénérer : UPDATE_DESIGN_TOKENS=1 npx vitest run src/design/tokens.test.ts",
    " */",
    `${selector} {`,
    ...lines,
    "}",
    "",
  ].join("\n");
}
