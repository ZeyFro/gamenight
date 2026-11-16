import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_LINKS } from "./nav-links";
import { SIDEBAR_GROUPS } from "./app/Sidebar";

const sidebarLinks = SIDEBAR_GROUPS.flatMap((group) => [...group.links]);

function pageFile(href: string) {
  return join(process.cwd(), href === "/" ? "src/app/page.tsx" : `src/app${href.replace(/\/$/, "")}/page.tsx`);
}

describe("cohérence de la navigation", () => {
  it("ne propose chaque destination qu'une fois dans la barre basse", () => {
    const hrefs = NAV_LINKS.map(({ href }) => href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(NAV_LINKS.map(({ icon }) => icon)).size).toBe(NAV_LINKS.length);
  });

  // Garde de non-régression : `Classement` est sorti de la barre basse pour
  // faire place à l'accueil ; il doit rester joignable depuis le tiroir.
  it("garde dans le tiroir toutes les pages de la barre basse et le classement", () => {
    const sidebarHrefs = new Set(sidebarLinks.map(({ href }) => href));
    for (const { href } of NAV_LINKS) expect(sidebarHrefs.has(href)).toBe(true);
    expect(sidebarHrefs.has("/classement")).toBe(true);
  });

  // Aucune entrée de nav ne doit mener à une page inexistante : la barre
  // basse comme le tiroir sont vérifiés, y compris « Classement » qui n'est
  // plus dans la barre.
  it("pointe uniquement vers des pages qui existent", () => {
    for (const { href } of [...NAV_LINKS, ...sidebarLinks]) {
      expect(existsSync(pageFile(href)), `page absente pour ${href}`).toBe(true);
    }
  });

  // Deux destinations voisines avec la même icône prêtaient à confusion
  // (Accueil/Roulette, Soirées/Calendrier). Le groupe « Les jeux » est exclu :
  // ses cinq entrées partagent volontairement l'icône livre.
  it("n'utilise pas deux fois la même icône dans le groupe Jouer ensemble", () => {
    const group = SIDEBAR_GROUPS.find(({ label }) => label === "Jouer ensemble");
    if (!group) throw new Error("Groupe « Jouer ensemble » absent du tiroir");
    const icons = group.links.map(({ icon }) => icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
