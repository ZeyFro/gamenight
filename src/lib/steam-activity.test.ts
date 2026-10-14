import { describe, it, expect } from "vitest";
import {
  selectMostRecentByTimestamp,
  selectMostRecentByPlaytime,
  computeSteamActivityUpdate,
  formatSteamActivityLabel,
  categorizeActivityOutcome,
  categorizeRecentOnlyOutcome,
  buildActivityRefreshWrite,
  STEAM_ACTIVITY_CALL_TIMEOUT_MS,
  type SteamOwnedGame,
  type SteamRecentGame,
  type GetOwnedGamesResult,
  type ActivityRefreshOutcome,
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

/**
 * Fix "cron Steam surdimensionné" — `refreshSteamActivity` (rafraîchissement
 * léger, sans réimport de bibliothèque) délègue sa décision d'écriture à ces
 * deux fonctions PURES, testées ici sans aucun accès réseau/Prisma. Les 5
 * catégories demandées (precise/approximate/none/private/error) doivent
 * rester mutuellement distinguables jusque dans l'écriture Prisma produite.
 */
describe("categorizeActivityOutcome", () => {
  it("profil privé (getOwnedGames ok:false) : catégorie private, quel que soit le repli", () => {
    const ownedGamesResult: GetOwnedGamesResult = { ok: false, reason: "private" };
    expect(categorizeActivityOutcome(ownedGamesResult)).toEqual({ category: "private" });
  });

  it("rtime_last_played exploitable : catégorie precise, priorité sur tout repli", () => {
    const ownedGamesResult: GetOwnedGamesResult = {
      ok: true,
      games: [{ appid: 1, name: "Précis", rtime_last_played: 1_700_000_000 }],
    };
    expect(categorizeActivityOutcome(ownedGamesResult)).toEqual({
      category: "precise",
      lastPlayedGame: "Précis",
      lastPlayedAt: new Date(1_700_000_000 * 1000),
    });
  });

  it("aucun rtime_last_played, repli avec résultat : catégorie approximate", () => {
    const ownedGamesResult: GetOwnedGamesResult = {
      ok: true,
      games: [{ appid: 1, name: "Sans timestamp" }],
    };
    expect(
      categorizeActivityOutcome(ownedGamesResult, {
        status: "success",
        games: [{ appid: 2, name: "Repli", playtime_2weeks: 42 }],
      })
    ).toEqual({ category: "approximate", lastPlayedGame: "Repli" });
  });

  it("aucun rtime_last_played, repli réussi mais vide : catégorie none", () => {
    const ownedGamesResult: GetOwnedGamesResult = { ok: true, games: [{ appid: 1, name: "X" }] };
    expect(
      categorizeActivityOutcome(ownedGamesResult, { status: "success", games: [] })
    ).toEqual({ category: "none" });
  });

  it("aucun rtime_last_played, repli en erreur : catégorie error (jamais confondue avec none)", () => {
    const ownedGamesResult: GetOwnedGamesResult = { ok: true, games: [{ appid: 1, name: "X" }] };
    expect(categorizeActivityOutcome(ownedGamesResult, { status: "error" })).toEqual({
      category: "error",
    });
  });

  it("aucun rtime_last_played, repli jamais tenté (outcome absent) : catégorie error", () => {
    const ownedGamesResult: GetOwnedGamesResult = { ok: true, games: [{ appid: 1, name: "X" }] };
    expect(categorizeActivityOutcome(ownedGamesResult)).toEqual({ category: "error" });
  });
});

describe("buildActivityRefreshWrite", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  it("error : ne touche NI steamPublic NI l'activité affichée, seul steamActivityCheckedAt est posé", () => {
    const write = buildActivityRefreshWrite({ category: "error" }, now);
    expect(write).toEqual({ steamActivityCheckedAt: now });
    expect(write.steamPublic).toBeUndefined();
    expect(write.lastPlayedGame).toBeUndefined();
    expect(write.lastPlayedAt).toBeUndefined();
  });

  it("private : efface explicitement l'activité affichée et marque steamPublic false", () => {
    const write = buildActivityRefreshWrite({ category: "private" }, now);
    expect(write).toEqual({
      steamActivityCheckedAt: now,
      steamPublic: false,
      lastPlayedGame: null,
      lastPlayedAt: null,
    });
  });

  it("precise : steamPublic true + activité exacte", () => {
    const outcome: ActivityRefreshOutcome = {
      category: "precise",
      lastPlayedGame: "Minecraft",
      lastPlayedAt: new Date("2026-09-15T10:00:00.000Z"),
    };
    expect(buildActivityRefreshWrite(outcome, now)).toEqual({
      steamActivityCheckedAt: now,
      steamPublic: true,
      lastPlayedGame: "Minecraft",
      lastPlayedAt: new Date("2026-09-15T10:00:00.000Z"),
    });
  });

  it("approximate : steamPublic true + nom seul, lastPlayedAt explicitement null (jamais de date fabriquée)", () => {
    const outcome: ActivityRefreshOutcome = { category: "approximate", lastPlayedGame: "Splatoon" };
    expect(buildActivityRefreshWrite(outcome, now)).toEqual({
      steamActivityCheckedAt: now,
      steamPublic: true,
      lastPlayedGame: "Splatoon",
      lastPlayedAt: null,
    });
  });

  it("none : steamPublic true + activité effacée (aucune activité récente, pas d'ancien jeu figé)", () => {
    const write = buildActivityRefreshWrite({ category: "none" }, now);
    expect(write).toEqual({
      steamActivityCheckedAt: now,
      steamPublic: true,
      lastPlayedGame: null,
      lastPlayedAt: null,
    });
  });
});

/**
 * Fix (correction utilisateur — pire cas initial sous-évalué à 16s au lieu
 * de 32s réels) : pour 5 comptes en lots de 3 (`BATCH_SIZE`, cf.
 * `steam-library-sync/route.ts`), il faut 2 lots séquentiels (3 puis 2),
 * jusqu'à 2 appels Steam séquentiels par compte (précis + repli). Ce test
 * fige l'arithmétique pour ne plus jamais la laisser dériver silencieusement
 * si `STEAM_ACTIVITY_CALL_TIMEOUT_MS` change sans que quelqu'un revérifie le
 * pire cas contre le timeout 30s du déclencheur externe (cron-job.org).
 */
describe("pire cas théorique du cron léger (arithmétique figée)", () => {
  it("2 lots séquentiels x 2 appels x timeout individuel reste sous 30s", () => {
    const BATCH_SIZE = 3;
    const userCount = 5;
    const batchCount = Math.ceil(userCount / BATCH_SIZE);
    const maxSequentialCallsPerUser = 2; // précis + repli

    const worstCaseMs = batchCount * maxSequentialCallsPerUser * STEAM_ACTIVITY_CALL_TIMEOUT_MS;

    expect(batchCount).toBe(2);
    expect(worstCaseMs).toBe(24_000);
    expect(worstCaseMs).toBeLessThan(30_000);
  });
});

describe("categorizeRecentOnlyOutcome (repli dégradé : GetOwnedGames a échoué)", () => {
  it("parties récentes : activité approximative, jeu au plus grand playtime_2weeks", () => {
    expect(
      categorizeRecentOnlyOutcome([
        { appid: 1, name: "A", playtime_2weeks: 10 },
        { appid: 2, name: "B", playtime_2weeks: 200 },
      ])
    ).toEqual({ category: "approximate", lastPlayedGame: "B" });
  });

  it("liste vide : ambigu (privé ou aucune partie) → error, JAMAIS « none » qui effacerait l'activité", () => {
    expect(categorizeRecentOnlyOutcome([])).toEqual({ category: "error" });
  });
});
