import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde de non-régression (source) : zones tactiles >= 44 px sur mobile et
 * bouton flottant d'onboarding au-dessus de la barre basse. Le rendu réel est
 * mesuré à part (Playwright jetable) ; ces tests échouent si les classes ou
 * règles CSS qui portent la correction disparaissent.
 */
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Nombre de balises/attributs className contenant `gn-touch-target` dans le fichier. */
const touchCount = (src: string) => (src.match(/gn-touch-target\b/g) ?? []).length;

describe("règle CSS de zone tactile", () => {
  const css = read("app/refonte.css");

  it("agrandit la zone à 44 px minimum pour les pointeurs imprécis uniquement", () => {
    const block = css.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(block, "bloc @media (pointer: coarse)").not.toBeNull();
    expect(block![1]).toMatch(/\.gn-touch-target::after\s*\{[^}]*width:\s*max\(100%,\s*44px\)[^}]*height:\s*max\(100%,\s*44px\)/);
    expect(block![1]).toMatch(/\.gn-touch-target-end::after/);
  });

  it("ne positionne pas l'élément lui-même (sinon écrase absolute/fixed)", () => {
    expect(css).not.toMatch(/\.gn-touch-target\s*\{/);
  });
});

describe("cibles tactiles marquées gn-touch-target + relative", () => {
  const cases: Array<[string, number]> = [
    ["components/chat/ChatPanel.tsx", 2],
    ["components/NotificationBell.tsx", 2],
    ["components/EditGameDialog.tsx", 2],
    ["components/BibliothequeGrid.tsx", 2],
    ["components/CopyProfileLinkButton.tsx", 2],
    ["app/profil/layout.tsx", 2],
  ];
  it.each(cases)("%s", (file, min) => {
    const src = read(file);
    expect(touchCount(src)).toBeGreaterThanOrEqual(min);
    // chaque occurrence doit rester accompagnée de `relative` (ancre du pseudo-élément)
    for (const m of src.matchAll(/className="([^"]*gn-touch-target[^"]*)"/g)) {
      expect(m[1]).toMatch(/\brelative\b/);
    }
  });

  it("le bouton « Marquer comme coop » reste dans la carte à overflow masqué", () => {
    expect(read("components/BibliothequeGrid.tsx")).toMatch(/gn-touch-target-end[^"]*text-\[11px\]/);
  });

  it("l'espace entre éditer/retirer passe à 8 px au tactile (pas de zones qui se chevauchent)", () => {
    expect(read("components/BibliothequeGrid.tsx")).toContain("gap-1.5 pointer-coarse:gap-2");
  });
});

describe("OnboardingPrompt : bouton flottant au-dessus des éléments fixes", () => {
  const src = read("components/onboarding/OnboardingPrompt.tsx");
  const fab = src.match(/<Button size="sm"[^\n]*?className="([^"]*)"/)?.[1] ?? "";

  it("se place au-dessus de la barre basse + zone de sécurité (mobile)", () => {
    expect(fab).toContain("bottom-[calc(5rem+env(safe-area-inset-bottom))]");
    expect(fab).toContain("lg:bottom-5");
  });

  it("ne déborde pas sur le bouton « ? » (GuideFab) à droite et garde 44 px de haut", () => {
    expect(fab).toContain("max-w-[calc(100%-6rem)]");
    expect(fab).toContain("min-h-11");
    expect(fab).toContain("lg:max-w-none");
  });

  it("garde sa logique d'affichage (sessionStorage, étapes de configuration)", () => {
    expect(src).toContain('sessionStorage.getItem(key) === "later"');
    expect(src).toContain("if (!incomplete || workingOnSetup) return null;");
  });
});
