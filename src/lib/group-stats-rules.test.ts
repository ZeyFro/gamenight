import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activePlayersCaption, membersLabel, otherMembersLabel, reconcileGroupStats } from "@/lib/group-stats-rules";

/** Audit du 23/11/2026 : « 0 soirée jouée » à côté de « Deadlock · 8 fois », Potes 8 membres / classement 9 / base 10. */
describe("reconcileGroupStats", () => {
  it("relève le total de soirées au compteur du jeu le plus joué quand le compteur de soirées est en retard", () => {
    expect(reconcileGroupStats({ totalSessionsPlayed: 0, mostPlayedCount: 8, activePlayers: 0 }, 9)).toEqual({
      totalSessionsPlayed: 8,
      activePlayers: 0,
      sessionsRaisedToGameCount: true,
    });
  });
  it("ne touche pas un total déjà cohérent", () => {
    expect(reconcileGroupStats({ totalSessionsPlayed: 18, mostPlayedCount: 8, activePlayers: 5 }, 9)).toEqual({
      totalSessionsPlayed: 18,
      activePlayers: 5,
      sessionsRaisedToGameCount: false,
    });
  });
  it("jamais plus de joueurs actifs que de membres, jamais de nombre négatif ou décimal", () => {
    expect(reconcileGroupStats({ totalSessionsPlayed: -3, mostPlayedCount: null, activePlayers: 12 }, 9)).toMatchObject({ totalSessionsPlayed: 0, activePlayers: 9 });
    expect(reconcileGroupStats({ totalSessionsPlayed: 4.9, mostPlayedCount: 2.2, activePlayers: 3.7 }, 0)).toMatchObject({ totalSessionsPlayed: 4, activePlayers: 0 });
  });
});

describe("libellés partagés (accord et définitions uniques)", () => {
  it("membres : toi compris ; autres membres : sans toi", () => {
    expect(membersLabel(9)).toBe("9 membres actifs");
    expect(membersLabel(1)).toBe("1 membre actif");
    expect(otherMembersLabel(8)).toBe("8 autres membres");
    expect(otherMembersLabel(1)).toBe("1 autre membre");
  });
  it("légende des joueurs actifs avec son dénominateur", () => {
    expect(activePlayersCaption(5, 9)).toBe("5 joueurs actifs sur 9 membres (vus ces 7 derniers jours)");
    expect(activePlayersCaption(1, 1)).toBe("1 joueur actif sur 1 membre (vus ces 7 derniers jours)");
  });
});

describe("les pages utilisent les définitions communes", () => {
  it("accueil, accueil-v2, Potes et classement lisent les libellés partagés", () => {
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("activePlayersCaption(");
    expect(readFileSync("src/app/accueil-v2/page.tsx", "utf8")).toContain("activePlayersCaption(");
    expect(readFileSync("src/app/potes/page.tsx", "utf8")).toContain("otherMembersLabel(");
    expect(readFileSync("src/app/classement/page.tsx", "utf8")).toContain("membersLabel(");
  });
  it("getGroupStats borne ses lectures à la communauté et réconcilie les chiffres", () => {
    const home = readFileSync("src/lib/home.ts", "utf8");
    expect(home).toContain("reconcileGroupStats(");
    expect(home).toContain("getGroupMemberCounts(viewerId)");
  });
});
