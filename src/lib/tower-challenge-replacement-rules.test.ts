import { describe, expect, it } from "vitest";
import { isTowerChallengeReplacementEnabled, pickReplacementDefinition, towerReplacementBlock } from "./tower-challenge-replacement-rules";

const now = new Date("2026-12-10T12:00:00Z");
const future = new Date("2026-12-11T12:00:00Z");
const base = { status: "ASSIGNED", teamId: null, expiresAt: future, requiredGameId: "g1", alreadyReplaced: false };

describe("remplacement de défi : règles pures", () => {
  it.each([undefined, "", "false", "TRUE"])("drapeau %o : éteint", value => {
    expect(isTowerChallengeReplacementEnabled({ TOWER_CHALLENGE_REPLACEMENT_ENABLED: value })).toBe(false);
  });
  it("drapeau true : allumé", () => {
    expect(isTowerChallengeReplacementEnabled({ TOWER_CHALLENGE_REPLACEMENT_ENABLED: "true" })).toBe(true);
  });

  it("autorise un défi solo à réaliser dont le jeu n'est pas possédé", () => {
    expect(towerReplacementBlock(base, new Set(["g2"]), now)).toBeNull();
    expect(towerReplacementBlock(base, new Set(), now)).toBeNull();
  });
  it.each([
    [{ teamId: "t1" }, "team"], [{ status: "SUBMITTED" }, "not_assigned"], [{ status: "APPROVED" }, "not_assigned"],
    [{ expiresAt: now }, "expired"], [{ expiresAt: new Date("2026-12-09T00:00:00Z") }, "expired"],
    [{ requiredGameId: null }, "no_game_required"], [{ alreadyReplaced: true }, "already_replaced"],
  ] as const)("bloque %o : %s", (patch, expected) => {
    expect(towerReplacementBlock({ ...base, ...patch }, new Set(["g2"]), now)).toBe(expected);
  });
  it("bloque si le jeu est possédé", () => {
    expect(towerReplacementBlock(base, new Set(["g1"]), now)).toBe("game_owned");
  });
  it("une seule fois même quand les autres conditions sont remplies", () => {
    expect(towerReplacementBlock({ ...base, alreadyReplaced: true }, new Set(), now)).toBe("already_replaced");
  });

  describe("défi équivalent", () => {
    const input = { currentId: "cur", rewardFloors: 2, ownedGameIds: new Set(["owned"]), seenIds: new Set<string>() };
    const first = (n: number) => { void n; return 0; };
    const defs = [
      { id: "cur", rewardFloors: 2, gameId: "g1" },
      { id: "easy", rewardFloors: 1, gameId: null },
      { id: "hard", rewardFloors: 3, gameId: null },
      { id: "unowned", rewardFloors: 2, gameId: "g9" },
      { id: "free", rewardFloors: 2, gameId: null },
      { id: "ownedGame", rewardFloors: 2, gameId: "owned" },
    ];
    it("garde le même nombre d'étages, exclut le défi courant et les jeux non possédés", () => {
      const picks = new Set<string>();
      for (let i = 0; i < 2; i++) picks.add(pickReplacementDefinition(defs, input, () => i)?.id ?? "");
      expect([...picks].sort()).toEqual(["free", "ownedGame"]);
    });
    it("préfère un défi jamais tenté", () => {
      expect(pickReplacementDefinition(defs, { ...input, seenIds: new Set(["free"]) }, first)?.id).toBe("ownedGame");
    });
    it("se rabat sur un défi déjà tenté plutôt que de ne rien proposer", () => {
      expect(pickReplacementDefinition(defs, { ...input, seenIds: new Set(["free", "ownedGame"]) }, first)).not.toBeNull();
    });
    it("renvoie null sans équivalent", () => {
      expect(pickReplacementDefinition(defs.filter(def => def.rewardFloors !== 2 || def.id === "cur" || def.id === "unowned"), input, first)).toBeNull();
      expect(pickReplacementDefinition([], input, first)).toBeNull();
    });
  });
});
