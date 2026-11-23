// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuroraText } from "@/components/magicui/aurora-text";

/** Bug 9 (audit du 23/11/2026) : petits défauts de l'accueil et du guide. */
afterEach(cleanup);
const source = (path: string) => readFileSync(path, "utf8");

describe("(a) le lien « Guide » ne flotte plus à côté du pseudo", () => {
  it("ni l'accueil ni son aperçu n'ont de lien Guide dans l'en-tête ; le guide reste dans la barre latérale et le « ? »", () => {
    expect(source("src/app/page.tsx")).not.toContain("📖 Guide");
    expect(source("src/app/accueil-v2/page.tsx")).not.toContain("📖 Guide");
    expect(source("src/components/app/Sidebar.tsx")).toContain('link("/guide"');
    expect(source("src/components/GuideFab.tsx")).toContain('href="/guide"');
  });
});

describe("(b) « Se déconnecter » n'est plus en bas de l'accueil", () => {
  it("retiré de l'accueil et de son aperçu, présent sur /profil", () => {
    expect(source("src/app/page.tsx")).not.toContain("Se déconnecter");
    expect(source("src/app/accueil-v2/page.tsx")).not.toContain("Se déconnecter");
    const profil = source("src/app/profil/page.tsx");
    expect(profil).toContain("Se déconnecter");
    expect(profil).toContain("await signOut()");
  });
});

describe("(g) le titre « Ce soir, on joue à quoi ? » n'apparaît qu'une fois", () => {
  it("AuroraText ne double pas son texte (plus de copie réservée aux lecteurs d'écran)", () => {
    const { container } = render(<AuroraText>Ce soir, on joue à quoi ?</AuroraText>);
    expect(container.textContent).toBe("Ce soir, on joue à quoi ?");
  });
});

describe("(h) /guide mentionne le salon Discord des commandes du bot", () => {
  it("le texte nomme 🤖・commandes-bot, sans lien inventé", () => {
    const guide = source("src/app/guide/page.tsx");
    expect(guide).toContain("🤖・commandes-bot");
    expect(guide).not.toMatch(/discord\.com\/channels/);
  });
});
