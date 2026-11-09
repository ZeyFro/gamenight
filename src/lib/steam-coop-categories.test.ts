import { describe, expect, it } from "vitest";
import { deriveIsCoopFromCategories } from "./steam-store";

const cat = (id: number, description: string) => ({ id, description });

// Ids vérifiés le 2026-11-09 (SteamDB, pages /charts/?category=<id>) :
// 9 Co-op · 24 Shared/Split Screen · 27 Cross-Platform Multiplayer · 38 Online Co-op ·
// 39 Shared/Split Screen Co-op · 48 LAN Co-op.
describe("deriveIsCoopFromCategories : ids de catégories Steam", () => {
  it.each([
    [9, "Co-op"],
    [24, "Shared/Split Screen"],
    [38, "Online Co-op"],
    [39, "Shared/Split Screen Co-op"],
    [48, "LAN Co-op"],
  ])("l'id %i (%s) compte comme coop, quel que soit le libellé", (id) => {
    expect(deriveIsCoopFromCategories([cat(id, "libellé localisé sans mot-clé")])).toBe(true);
  });

  it("le multijoueur multiplateforme (id 27) n'est pas du coop", () => {
    expect(deriveIsCoopFromCategories([cat(27, "Cross-Platform Multiplayer")])).toBe(false);
    expect(deriveIsCoopFromCategories([cat(27, "Multijoueur multiplateforme")])).toBe(false);
  });

  it("un jeu multiplateforme qui est aussi coop reste coop grâce à sa catégorie coop", () => {
    expect(deriveIsCoopFromCategories([cat(27, "Cross-Platform Multiplayer"), cat(38, "Online Co-op")])).toBe(true);
  });

  it("le mot-clé « partagé » seul est conservé (règle non modifiée)", () => {
    expect(deriveIsCoopFromCategories([cat(0, "Partagé")])).toBe(true);
  });
});
