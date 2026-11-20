import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOSTER_ELIGIBILITY_KEY,
  PROFILE_COSMETICS,
  PROFILE_KIND_FIELD,
  contrastRatio,
  earnedKeysFor,
  getProfileCosmetic,
  isProfileCustomizationEnabled,
  profileShopItems,
  profileShopPrice,
  validateShowcaseSize,
  type EarnProgress,
} from "./profile-cosmetics";
import { XP_SHOP_ITEMS } from "./xp-shop";

const css = readFileSync(new URL("../app/profile-cosmetics.css", import.meta.url), "utf8");
/** Corps des `@keyframes pc-*` (accolades équilibrées). */
function keyframeBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/@keyframes pc-[\w-]+ \{/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < source.length) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    bodies.push(source.slice(start, end - 1));
  }
  return bodies;
}
const none: EarnProgress = { floors: 0, grade: "Régulars", seasonsCompleted: 0, tournamentWins: 0, challengesValidated: 0 };

afterEach(() => vi.unstubAllEnvs());

describe("drapeau PROFILE_CUSTOMIZATION_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", value as string);
    expect(isProfileCustomizationEnabled()).toBe(expected);
  });
});

describe("catalogue", () => {
  it("a des identifiants uniques, distincts de la boutique historique, et un champ de personnalisation par type", () => {
    const ids = PROFILE_COSMETICS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const legacy = new Set<string>(XP_SHOP_ITEMS.map((item) => item.id));
    expect(ids.filter((id) => legacy.has(id))).toEqual([]);
    for (const item of PROFILE_COSMETICS) expect(PROFILE_KIND_FIELD[item.kind]).toBeTruthy();
  });

  it("définit une classe CSS pour chaque identifiant (rendu par classe, jamais par valeur libre)", () => {
    // Les titres sont du texte : aucun style.
    for (const item of PROFILE_COSMETICS.filter((entry) => entry.kind !== "PROFILE_TITLE")) expect(css, item.id).toContain(`.pc-${item.id}`);
  });

  it("garde l'obtention gagnée et boosters hors de la boutique (jamais achetable)", () => {
    const shopIds = new Set(profileShopItems().map((item) => item.id));
    for (const item of PROFILE_COSMETICS) {
      if (item.acquisition.mode === "SHOP") expect(shopIds.has(item.id)).toBe(true);
      else {
        expect(shopIds.has(item.id), item.id).toBe(false);
        expect(profileShopPrice(item.id), item.id).toBeNull();
      }
    }
    expect(profileShopPrice("inconnu")).toBeNull();
    expect(profileShopPrice("fx-flames")).toBe(800);
  });

  it("couvre les types demandés, avec des éléments gagnés, achetables et exclusifs boosters", () => {
    expect(new Set(PROFILE_COSMETICS.map((item) => item.kind))).toEqual(new Set(Object.keys(PROFILE_KIND_FIELD)));
    for (const mode of ["SHOP", "EARNED", "BOOSTER"]) expect(PROFILE_COSMETICS.some((item) => item.acquisition.mode === mode)).toBe(true);
  });

  it("n'expose aucune notion d'avantage de jeu", () => {
    const serialized = JSON.stringify(PROFILE_COSMETICS).toLowerCase();
    for (const word of ["xpbonus", "bonus d'xp", "priorité", "priority", "floorsbonus"]) expect(serialized).not.toContain(word);
  });

  it("garde le drapeau booster hors du catalogue (simple drapeau d'éligibilité)", () => {
    expect(getProfileCosmetic(BOOSTER_ELIGIBILITY_KEY)).toBeNull();
  });
});

describe("accessibilité : contraste", () => {
  const backgrounds = ["#101014", "#1a1a20"];
  it("garde chaque couleur de pseudo lisible (≥ 4,5:1) sur les fonds de l'app", () => {
    const styles = PROFILE_COSMETICS.filter((item) => item.kind === "NAME_STYLE");
    expect(styles.length).toBeGreaterThan(3);
    for (const item of styles) for (const color of item.preview ?? []) for (const bg of backgrounds) {
      expect(contrastRatio(color, bg), `${item.id} ${color} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("garde le texte clair lisible (≥ 4,5:1) sur chaque thème de carte", () => {
    const themes = PROFILE_COSMETICS.filter((item) => item.kind === "CARD_THEME");
    expect(themes.length).toBeGreaterThan(2);
    for (const item of themes) {
      const [background, text] = item.preview ?? [];
      expect(contrastRatio(text, background), item.id).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("calcule le contraste WCAG (noir/blanc = 21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("retrouve dans le CSS les couleurs d'aperçu des pseudos", () => {
    for (const item of PROFILE_COSMETICS.filter((entry) => entry.kind === "NAME_STYLE")) {
      for (const color of item.preview ?? []) expect(css.toLowerCase(), item.id).toContain(color);
    }
  });
});

describe("règles gagnées", () => {
  it("n'attribue rien à un membre sans progression", () => {
    expect(earnedKeysFor(none)).toEqual([]);
  });
  it("attribue par étages, sans jamais regarder l'XP", () => {
    expect(earnedKeysFor({ ...none, floors: BigInt(10) })).toEqual(expect.arrayContaining(["card-tower", "ptitle-climber"]));
    expect(earnedKeysFor({ ...none, floors: 9 })).toEqual([]);
    expect(earnedKeysFor({ ...none, floors: BigInt(30) })).toContain("fx-flames-ranker");
  });
  it("Ranker atteint aussi par High Ranker ; Irregular uniquement par attribution manuelle", () => {
    expect(earnedKeysFor({ ...none, grade: "Ranker" })).toContain("name-gold");
    expect(earnedKeysFor({ ...none, grade: "Ranker" })).not.toContain("name-crimson");
    const high = earnedKeysFor({ ...none, grade: "High Ranker" });
    expect(high).toEqual(expect.arrayContaining(["name-gold", "name-crimson"]));
    expect(high).not.toContain("name-violet");
    expect(earnedKeysFor({ ...none, grade: "Irregular" })).toContain("name-violet");
  });
  it("attribue par saisons, tournois et défis", () => {
    expect(earnedKeysFor({ ...none, seasonsCompleted: 1 })).toContain("banner-season");
    expect(earnedKeysFor({ ...none, seasonsCompleted: 2 })).toContain("ptitle-veteran");
    expect(earnedKeysFor({ ...none, tournamentWins: 1 })).toContain("frame-champion");
    expect(earnedKeysFor({ ...none, tournamentWins: 3 })).toContain("ptitle-champion");
    expect(earnedKeysFor({ ...none, challengesValidated: 5 })).toContain("ptitle-challenger");
  });
  it("ne distribue jamais les exclusifs boosters ni les éléments de boutique", () => {
    const all = earnedKeysFor({ floors: BigInt(10_000), grade: "High Ranker", seasonsCompleted: 50, tournamentWins: 50, challengesValidated: 500 });
    for (const key of all) expect(getProfileCosmetic(key)?.acquisition.mode).toBe("EARNED");
  });
});

describe("vitrine de badges", () => {
  it.each([
    [[], "ok"], [["a", "b"], "too_few"], [["a", "b", "c"], "ok"], [["a", "b", "c", "d", "e", "f"], "ok"],
    [["a", "b", "c", "d", "e", "f", "g"], "too_many"], [["a", "a", "b"], "duplicate"],
  ] as const)("%j : %s", (ids, expected) => {
    expect(validateShowcaseSize(ids)).toBe(expected);
  });
});

describe("CSS : légèreté et mouvement", () => {
  it("coupe les animations pour le spectateur (préférence) et pour prefers-reduced-motion", () => {
    expect(css).toContain('[data-pc-effects="off"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toMatch(/\[data-pc-effects="off"\] \.pc-layer \{ display: none; \}/);
  });
  it("n'anime que transform, opacity, background-position et box-shadow (pas de filtre ni de flou)", () => {
    expect(css).not.toMatch(/filter:|backdrop-filter|blur\(/);
    const keyframes = keyframeBodies(css);
    expect(keyframes.length).toBeGreaterThan(8);
    for (const body of keyframes) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((match) => match[1]);
      for (const prop of props) expect(["transform", "opacity", "background-position", "box-shadow"], prop).toContain(prop);
    }
  });
  it("ne charge aucune ressource externe", () => {
    expect(css).not.toMatch(/url\(|@import/);
  });
});
