import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegalFooter } from "./LegalFooter";

beforeEach(() => vi.stubEnv("LEGAL_PAGES_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("pied de page légal sur téléphone", () => {
  it("chaque lien est une cible tactile d'au moins 44 px de haut", () => {
    const html = renderToStaticMarkup(<LegalFooter raised />);
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(link).toContain("min-h-11");
  });
  it("connecté, l'espace du bas dépasse la barre de navigation ET le bouton flottant « Compléter mon profil »", () => {
    const html = renderToStaticMarkup(<LegalFooter raised />);
    expect(html).toContain("pb-[calc(9rem+env(safe-area-inset-bottom))]");
    expect(html).toContain("lg:pb-4");
  });
  it("visiteur : pas d'espace supplémentaire ; flag éteint : rien du tout", () => {
    expect(renderToStaticMarkup(<LegalFooter />)).not.toContain("pb-[calc");
    vi.stubEnv("LEGAL_PAGES_ENABLED", "false");
    expect(renderToStaticMarkup(<LegalFooter raised />)).toBe("");
  });
});
