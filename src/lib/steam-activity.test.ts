import { describe, it, expect } from "vitest";
import {
  selectMostRecentByTimestamp,
  selectMostRecentByPlaytime,
  computeSteamActivityUpdate,
  formatSteamActivityLabel,
  type SteamOwnedGame,
  type SteamRecentGame,
} from "@/lib/steam";

/**
 * Fix "activité Steam invisible" — `rtime_last_played` (GetOwnedGames)
 * s'est révélé non fiable en Production malgré une bibliothèque
 * correctement importée. Ces tests couvrent la logique PURE de décision
 * (aucun appel Steam réel, aucun accès Prisma) : sélection du jeu le plus
 * récent par source, priorité entre les deux niveaux, et distinction
 * impérative entre "aucune activité" et "erreur réseau" (jamais de perte
 * silencieuse d'une info valide).
 */

describe("selectMostRecentByTimestamp", () => {
  it("plusieurs rtime_last_played valides : choisit le plus récent", () => {
    const games: SteamOwnedGame[] = [
      { appid: 1, name: "A", rtime_last_played: 1000 },
      { appid: 2, name: "B", rtime_last_played: 3000 },
      { appid: 3, name: "C", rtime_last_played: 2000 },
    ];
    expect(selectMostRecentByTimestamp(games)?.name).toBe("B");
  });

  it("absence totale du champ non officiel : undefined", () => {
    const games: SteamOwnedGame[] = [
      { appid: 1, name: "A" },
      { appid: 2, name: "B" },
    ];
    expect(selectMostRecentByTimestamp(games)).toBeUndefined();
  });

  it("rtime_last_played à 0 (jamais lancé) : ignoré, pas exploitable", () => {
    const games: SteamOwnedGame[] = [{ appid: 1, name: "A", rtime_last_played: 0 }];
    expect(selectMostRecentByTimestamp(games)).toBeUndefined();
  });

  it("liste de jeux vide : undefined", () => {
    expect(selectMostRecentByTimestamp([])).toBeUndefined();
  });
});

describe("selectMostRecentByPlaytime (repli GetRecentlyPlayedGames)", () => {
  it("sélection déterministe : le plus de playtime_2weeks gagne, quel que soit l'ordre d'entrée", () => {
    const games: SteamRecentGame[] = [
      { appid: 1, name: "A", playtime_2weeks: 30 },
      { appid: 2, name: "B", playtime_2weeks: 120 },
      { appid: 3, name: "C", playtime_2weeks: 90 },
    ];
    expect(selectMostRecentByPlaytime(games)?.name).toBe("B");
    // Ordre inversé — même résultat (ne se fie jamais à l'ordre renvoyé par Steam).
    expect(selectMostRecentByPlaytime([...games].reverse())?.name).toBe("B");
  });

  it("liste vide : undefined", () => {
    expect(selectMostRecentByPlaytime([])).toBeUndefined();
  });
});

describe("computeSteamActivityUpdate", () => {
  it("rtime_last_played exploitable : priorité absolue, timestamp exact", () => {
    const result = computeSteamActivityUpdate([
      { appid: 1, name: "Précis", rtime_last_played: 1_700_000_000 },
    ]);
    expect(result).toEqual({
      lastPlayedGame: "Précis",
      lastPlayedAt: new Date(1_700_000_000 * 1000),
    });
  });

  it("aucun rtime_last_played, repli avec résultat récent disponible : nom seul, lastPlayedAt null", () => {
    const result = computeSteamActivityUpdate([{ appid: 1, name: "Sans timestamp" }], {
      status: "success",
      games: [{ appid: 2, name: "Repli", playtime_2weeks: 42 }],
    });
    expect(result).toEqual({ lastPlayedGame: "Repli", lastPlayedAt: null });
  });

  it("repli réussi mais liste récente vide : aucune activité, les deux champs à null", () => {
    const result = computeSteamActivityUpdate([{ appid: 1, name: "X" }], {
      status: "success",
      games: [],
    });
    expect(result).toEqual({ lastPlayedGame: null, lastPlayedAt: null });
  });

  it("repli en erreur : null global, l'appelant ne doit rien écraser", () => {
    const result = computeSteamActivityUpdate([{ appid: 1, name: "X" }], { status: "error" });
    expect(result).toBeNull();
  });

  it("aucun rtime_last_played et repli jamais appelé (outcome absent) : null, ne rien écraser", () => {
    expect(computeSteamActivityUpdate([{ appid: 1, name: "X" }])).toBeNull();
  });

  it("différence vide vs erreur : les deux sont bien distincts (vide -> null explicite, erreur -> aucune écriture)", () => {
    const empty = computeSteamActivityUpdate([], { status: "success", games: [] });
    const error = computeSteamActivityUpdate([], { status: "error" });
    expect(empty).toEqual({ lastPlayedGame: null, lastPlayedAt: null });
    expect(error).toBeNull();
    expect(empty).not.toBeNull();
  });
});

describe("formatSteamActivityLabel", () => {
  const now = new Date("2026-09-15T12:00:00.000Z").getTime();

  it("lastPlayedGame + lastPlayedAt : version précise avec durée", () => {
    const lastPlayedAt = new Date(now - 2 * 60 * 60 * 1000); // 2h avant
    expect(formatSteamActivityLabel("Minecraft", lastPlayedAt, now)).toBe(
      "A joué à Minecraft — il y a 2 h"
    );
  });

  it("lastPlayedGame sans lastPlayedAt : version dégradée, sans durée fabriquée", () => {
    expect(formatSteamActivityLabel("Splatoon", null, now)).toBe("A joué récemment à Splatoon");
  });

  it("aucun jeu connu : null, rien à afficher", () => {
    expect(formatSteamActivityLabel(null, null, now)).toBeNull();
  });

  it("cas incohérent (lastPlayedAt sans lastPlayedGame) : null quand même, jamais de texte sans nom de jeu", () => {
    expect(formatSteamActivityLabel(null, new Date(now), now)).toBeNull();
  });
});
