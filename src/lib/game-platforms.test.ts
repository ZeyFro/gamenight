import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: vi.fn() } } }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: vi.fn() }));

import {
  crossplayLabel,
  filterChallengesPlayable,
  gamePlatformsSchema,
  isGamePlatformsEnabled,
  isPlayableByGroup,
  isPlayableOnPlayerPlatforms,
  platformFamily,
} from "@/lib/game-platforms";

afterEach(() => vi.unstubAllEnvs());

describe("flag", () => {
  it("OFF par défaut, exactement `true`", () => {
    expect(isGamePlatformsEnabled()).toBe(false);
    vi.stubEnv("GAME_PLATFORMS_ENABLED", "yes");
    expect(isGamePlatformsEnabled()).toBe(false);
    vi.stubEnv("GAME_PLATFORMS_ENABLED", "true");
    expect(isGamePlatformsEnabled()).toBe(true);
  });
});

describe("familles et compatibilité", () => {
  it("regroupe les plateformes PC", () => {
    expect(["WINDOWS", "MACOS", "LINUX"].map(platformFamily)).toEqual(["PC", "PC", "PC"]);
    expect(platformFamily("ANDROID")).toBe("MOBILE");
    expect(platformFamily("XBOX")).toBe("XBOX");
  });
  it("jeu PlayStation seul : impossible pour un joueur Xbox+PC, possible pour un joueur PlayStation", () => {
    expect(isPlayableOnPlayerPlatforms(["PLAYSTATION"], ["XBOX", "WINDOWS"])).toBe(false);
    expect(isPlayableOnPlayerPlatforms(["PLAYSTATION"], ["PLAYSTATION"])).toBe(true);
  });
  it("Windows et Linux sont la même famille PC", () => {
    expect(isPlayableOnPlayerPlatforms(["WINDOWS"], ["LINUX"])).toBe(true);
  });
  it("inconnu d'un côté ou de l'autre : jamais exclu", () => {
    expect(isPlayableOnPlayerPlatforms([], ["XBOX"])).toBe(true);
    expect(isPlayableOnPlayerPlatforms(["PLAYSTATION"], [])).toBe(true);
  });
  it("le crossplay n'ouvre pas un jeu à une plateforme que le joueur n'a pas", () => {
    // Même un jeu crossplay reste possédé sur une plateforme précise.
    expect(isPlayableOnPlayerPlatforms(["PLAYSTATION"], ["XBOX"])).toBe(false);
  });
});

describe("défis jamais impossibles", () => {
  const platforms = new Map([["ps", ["PLAYSTATION"]], ["pc", ["WINDOWS"]]]);
  const candidates = [{ id: "a", gameId: null }, { id: "b", gameId: "ps" }, { id: "c", gameId: "pc" }, { id: "d", gameId: "inconnu" }];

  it("retire les défis dont le jeu est impossible pour le joueur", () => {
    const result = filterChallengesPlayable(candidates, platforms, (game) => isPlayableOnPlayerPlatforms(game, ["XBOX"]));
    expect(result.map((c) => c.id)).toEqual(["a", "d"]);
  });
  it("joueur PC : défis PC, sans jeu ou jeu sans plateforme connue", () => {
    const result = filterChallengesPlayable(candidates, platforms, (game) => isPlayableOnPlayerPlatforms(game, ["WINDOWS"]));
    expect(result.map((c) => c.id)).toEqual(["a", "c", "d"]);
  });
  it("équipe : au moins deux membres doivent pouvoir jouer", () => {
    expect(isPlayableByGroup(["PLAYSTATION"], [["PLAYSTATION"], ["XBOX"], ["WINDOWS"]])).toBe(false);
    expect(isPlayableByGroup(["PLAYSTATION"], [["PLAYSTATION"], ["PLAYSTATION"], ["WINDOWS"]])).toBe(true);
    expect(isPlayableByGroup(["PLAYSTATION"], [["XBOX"], []])).toBe(false);
  });
});

describe("saisie fiche jeu", () => {
  it("valide plateformes et crossplay", () => {
    expect(gamePlatformsSchema.parse({ gameId: "g", platforms: ["XBOX", "XBOX", "WINDOWS"], crossplay: "yes" }))
      .toEqual({ gameId: "g", platforms: ["XBOX", "WINDOWS"], crossplay: true });
    expect(gamePlatformsSchema.parse({ gameId: "g", platforms: [], crossplay: "" }).crossplay).toBeNull();
    expect(gamePlatformsSchema.safeParse({ gameId: "g", platforms: ["ATARI"], crossplay: "" }).success).toBe(false);
  });
  it("libellés crossplay", () => {
    expect(crossplayLabel(null)).toMatch(/inconnu/);
    expect(crossplayLabel(true)).toMatch(/Crossplay/);
    expect(crossplayLabel(false)).toMatch(/Pas de/);
  });
});
