import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTokensCss, toCssVariables, toLinearGradient } from "./css-variables";
import { tokens } from "./tokens";

const DIR = __dirname;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("tokens.ts — autonome (réutilisable tel quel dans Expo)", () => {
  it("ne contient aucun import, require ni dépendance", () => {
    const source = readFileSync(join(DIR, "tokens.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfrom\s+["']/);
  });

  it("ne contient aucune unité CSS ni fonction CSS : que des nombres et des couleurs", () => {
    const flat = JSON.stringify({ ...tokens, colors: undefined });
    expect(flat).not.toMatch(/\d(px|rem|em|ms)"/);
    expect(flat).not.toMatch(/(linear-gradient|cubic-bezier|var\()/);
  });

  it("toutes les couleurs sont du #rrggbb ou du rgba()", () => {
    for (const group of Object.values(tokens.colors)) {
      for (const value of Object.values(group)) {
        expect(value).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+,\d+,\d+,[\d.]+\))$/i);
      }
    }
  });

  it("échelles cohérentes (espacements et rayons croissants, cibles tactiles ≥ 44)", () => {
    const spaces = Object.values(tokens.spacing);
    expect([...spaces].sort((a, b) => a - b)).toEqual(spaces);
    const radii = Object.values(tokens.radii);
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
    expect(tokens.layout.tapTarget).toBeGreaterThanOrEqual(44);
    expect(tokens.layout.fabSize).toBeGreaterThanOrEqual(tokens.layout.tapTarget);
    expect(tokens.layout.fabLift).toBeGreaterThan(0);
  });
});

describe("tokens.ts — lisibilité (WCAG AA, texte courant ≥ 4,5:1)", () => {
  const { background, text, violet, magenta, gold, status } = tokens.colors;

  it.each(Object.entries(background))("texte principal, secondaire et atténué sur le fond %s", (_name, bg) => {
    expect(contrast(text.primary, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text.muted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("le texte « faint » reste décoratif (≥ 3:1)", () => {
    expect(contrast(text.faint, background.base)).toBeGreaterThanOrEqual(3);
  });

  it("couleurs d'accent utilisées comme texte sur le fond", () => {
    for (const color of [violet[300], magenta[300], gold[300], gold[400], status.success, status.danger]) {
      expect(contrast(color, background.base)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("texte blanc sur les deux bouts du dégradé d'action", () => {
    for (const stop of tokens.gradients.action.stops) {
      expect(contrast(text.onAccent, stop.color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("variables CSS (css-variables.ts)", () => {
  const vars = toCssVariables();

  it("traduit les jetons avec les bonnes unités", () => {
    expect(vars["--gn-color-violet-500"]).toBe("#8b5cf6");
    expect(vars["--gn-space-4"]).toBe("16px");
    expect(vars["--gn-radius-pill"]).toBe("999px");
    expect(vars["--gn-font-weight-bold"]).toBe("700");
    expect(vars["--gn-duration-base"]).toBe("200ms");
    expect(vars["--gn-easing-standard"]).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(vars["--gn-layout-fab-size"]).toBe("64px");
    expect(vars["--gn-z-screen"]).toBe("60");
  });

  it("assemble dégradés et ombres multi-couches", () => {
    expect(vars["--gn-gradient-action"]).toBe("linear-gradient(135deg, #7c3aed 0%, #c026d3 100%)");
    expect(toLinearGradient(tokens.gradients.gold)).toContain("50%");
    expect(vars["--gn-shadow-fab"].split("rgba(").length - 1).toBe(2);
  });

  it("noms valides, aucune valeur cassée", () => {
    for (const [name, value] of Object.entries(vars)) {
      expect(name).toMatch(/^--gn-[a-z0-9-]+$/);
      expect(value).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("tokens.css est synchronisé avec tokens.ts", () => {
    const path = join(DIR, "tokens.css");
    const expected = renderTokensCss();
    if (process.env.UPDATE_DESIGN_TOKENS === "1") writeFileSync(path, expected);
    expect(
      // `core.autocrlf` (Windows) réécrit le fichier en CRLF au checkout.
      readFileSync(path, "utf8").replace(/\r\n/g, "\n"),
      "tokens.css périmé — régénérer : UPDATE_DESIGN_TOKENS=1 npx vitest run src/design/tokens.test.ts"
    ).toBe(expected);
  });

  it("design.css n'écrit jamais -webkit-backdrop-filter à la main (lightningcss supprimerait le flou standard)", () => {
    const css = readFileSync(join(DIR, "design.css"), "utf8");
    expect(css).not.toMatch(/^\s*-webkit-backdrop-filter\s*:/m);
  });

  it("design.css n'utilise que des variables --gn-* qui existent", () => {
    const css = readFileSync(join(DIR, "design.css"), "utf8");
    const used = new Set([...css.matchAll(/var\((--gn-[a-z0-9-]+)/g)].map((m) => m[1]));
    const local = new Set(["--gn-delay"]);
    const missing = [...used].filter((name) => !(name in vars) && !local.has(name));
    expect(missing).toEqual([]);
  });
});
