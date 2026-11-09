import { describe, expect, it } from "vitest";
import { compareTowerStandings, findExactTies, groupCoWinners, rankTowerStandings, selectTopThree, type TowerStandingInput } from "./tower-standings";

const at = (iso: string) => new Date(iso);
const e = (userId: string, floors: bigint | number, hardWins: number, reachedAt = "2026-11-01T10:00:00Z"): TowerStandingInput =>
  ({ userId, floors, hardWins, reachedAt: at(reachedAt) });
const ids = (list: readonly { userId: string }[]) => list.map(x => x.userId);

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

describe("classement Tower : ordre", () => {
  it("1. étages gagnés décroissants", () => {
    expect(ids(rankTowerStandings([e("a", 3, 9), e("b", 10, 0), e("c", 5, 5)]))).toEqual(["b", "c", "a"]);
  });
  it("2. à étages égaux, plus de défis à 3 étages d'abord", () => {
    expect(ids(rankTowerStandings([e("a", 6, 1), e("b", 6, 2), e("c", 6, 0)]))).toEqual(["b", "a", "c"]);
  });
  it("3. à étages et défis égaux, heure d'arrivée la plus tôt d'abord", () => {
    const list = [e("a", 6, 2, "2026-11-03T00:00:00Z"), e("b", 6, 2, "2026-11-01T00:00:00Z"), e("c", 6, 2, "2026-11-02T00:00:00Z")];
    expect(ids(rankTowerStandings(list))).toEqual(["b", "c", "a"]);
  });
  it("4. à égalité parfaite, userId croissant", () => {
    expect(ids(rankTowerStandings([e("c", 6, 2), e("a", 6, 2), e("b", 6, 2)]))).toEqual(["a", "b", "c"]);
  });
  it("un niveau supérieur l'emporte sur les suivants", () => {
    const list = [e("early", 5, 9, "2026-10-01T00:00:00Z"), e("top", 6, 0, "2026-12-01T00:00:00Z")];
    expect(ids(rankTowerStandings(list))).toEqual(["top", "early"]);
  });
  it("attribue les rangs 1..n sans ex æquo", () => {
    expect(rankTowerStandings([e("b", 1, 0), e("a", 1, 0), e("c", 2, 0)]).map(x => [x.userId, x.rank]))
      .toEqual([["c", 1], ["a", 2], ["b", 3]]);
  });
  it("liste vide", () => {
    expect(rankTowerStandings([])).toEqual([]);
  });
  it("compare les userId par unités de code (indépendant de la locale)", () => {
    expect(compareTowerStandings(e("B", 1, 0), e("a", 1, 0))).toBeLessThan(0);
  });
  it("compareTowerStandings est antisymétrique et nul seulement pour des entrées identiques", () => {
    const a = e("a", 4, 1);
    const b = e("b", 4, 1);
    expect(Math.sign(compareTowerStandings(a, b))).toBe(-Math.sign(compareTowerStandings(b, a)));
    expect(compareTowerStandings(a, { ...a })).toBe(0);
  });
});

describe("classement Tower : déterminisme", () => {
  const base = [
    e("d", 6, 2, "2026-11-02T00:00:00Z"),
    e("a", 6, 2, "2026-11-02T00:00:00Z"),
    e("b", 6, 2, "2026-11-01T00:00:00Z"),
    e("c", 6, 3, "2026-11-05T00:00:00Z"),
    e("e", 9, 0, "2026-11-09T00:00:00Z"),
  ];
  it("même résultat pour les 120 permutations d'entrée", () => {
    const expected = ["e", "c", "b", "a", "d"];
    const perms = permutations(base);
    expect(perms).toHaveLength(120);
    for (const perm of perms) {
      const ranked = rankTowerStandings(perm);
      expect(ids(ranked)).toEqual(expected);
      expect(ranked.map(x => x.rank)).toEqual([1, 2, 3, 4, 5]);
    }
  });
  it("ne mute pas l'entrée et ne partage pas ses objets", () => {
    const input = [e("b", 1, 0), e("a", 2, 0)];
    const snapshot = JSON.stringify(input);
    const frozen = Object.freeze(input.map(x => Object.freeze(x)));
    const ranked = rankTowerStandings(frozen);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(ranked).not.toBe(frozen);
    expect(ranked[0]).not.toBe(frozen[1]);
    expect("rank" in input[1]).toBe(false);
  });
  it("findExactTies ne mute pas l'entrée", () => {
    const input = [e("b", 1, 0), e("a", 1, 0)];
    findExactTies(input);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("classement Tower : bigint", () => {
  it("accepte bigint et number mélangés", () => {
    expect(ids(rankTowerStandings([e("a", BigInt(5), 0), e("b", 7, 0), e("c", BigInt(6), 0)]))).toEqual(["b", "c", "a"]);
  });
  it("number et bigint de même valeur sont égaux à ce niveau", () => {
    expect(ids(rankTowerStandings([e("b", BigInt(5), 0), e("a", 5, 0)]))).toEqual(["a", "b"]);
  });
  it("compare correctement au-delà de Number.MAX_SAFE_INTEGER", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) * BigInt(10);
    expect(ids(rankTowerStandings([e("a", big, 0), e("b", big + BigInt(1), 0)]))).toEqual(["b", "a"]);
  });
  it("conserve le type d'origine des étages dans le résultat", () => {
    const [first] = rankTowerStandings([e("a", BigInt(5), 0)]);
    expect(first.floors).toBe(BigInt(5));
  });
});

describe("classement Tower : entrées invalides", () => {
  it.each([
    ["étage négatif", e("a", -1, 0)],
    ["étage bigint négatif", e("a", BigInt(-1), 0)],
    ["étage non entier", e("a", 1.5, 0)],
    ["étage NaN", e("a", Number.NaN, 0)],
    ["étage infini", e("a", Number.POSITIVE_INFINITY, 0)],
    ["défis négatifs", e("a", 1, -1)],
    ["défis non entiers", e("a", 1, 0.5)],
    ["date invalide", { userId: "a", floors: 1, hardWins: 0, reachedAt: new Date("nope") }],
    ["date absente", { userId: "a", floors: 1, hardWins: 0, reachedAt: "2026-11-01" as unknown as Date }],
    ["userId vide", e("", 1, 0)],
  ])("%s : RangeError", (_label, bad) => {
    expect(() => rankTowerStandings([e("ok", 1, 0), bad])).toThrow(RangeError);
    expect(() => findExactTies([bad])).toThrow(RangeError);
    expect(() => compareTowerStandings(bad, e("ok", 1, 0))).toThrow(RangeError);
  });
  it("accepte zéro", () => {
    expect(ids(rankTowerStandings([e("a", 0, 0)]))).toEqual(["a"]);
  });
});

describe("findExactTies", () => {
  it("aucune égalité : liste vide", () => {
    expect(findExactTies([e("a", 1, 0), e("b", 2, 0), e("c", 2, 1)])).toEqual([]);
    expect(findExactTies([])).toEqual([]);
  });
  it("groupe les entrées égales sur (étages, défis, heure), triées par userId", () => {
    const groups = findExactTies([e("z", 6, 2), e("a", 6, 2), e("m", 6, 2), e("x", 3, 0)]);
    expect(groups.map(ids)).toEqual([["a", "m", "z"]]);
  });
  it("une différence à n'importe quel niveau sépare les groupes", () => {
    expect(findExactTies([e("a", 6, 2), e("b", 7, 2)])).toEqual([]);
    expect(findExactTies([e("a", 6, 2), e("b", 6, 3)])).toEqual([]);
    expect(findExactTies([e("a", 6, 2, "2026-11-01T00:00:00Z"), e("b", 6, 2, "2026-11-01T00:00:01Z")])).toEqual([]);
  });
  it("bigint et number de même valeur sont une égalité", () => {
    expect(findExactTies([e("a", BigInt(4), 1), e("b", 4, 1)]).map(ids)).toEqual([["a", "b"]]);
  });
  it("plusieurs groupes, dans l'ordre du classement", () => {
    const groups = findExactTies([e("d", 1, 0), e("c", 1, 0), e("b", 5, 0), e("a", 5, 0), e("solo", 3, 0)]);
    expect(groups.map(ids)).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("ne change pas le classement : userId reste le départage final", () => {
    expect(ids(rankTowerStandings([e("b", 5, 0), e("a", 5, 0)]))).toEqual(["a", "b"]);
  });
  it("résultat identique quelle que soit la permutation", () => {
    const base = [e("a", 6, 2), e("b", 6, 2), e("c", 6, 2), e("d", 1, 0), e("e", 1, 0)];
    const expected = [["a", "b", "c"], ["d", "e"]];
    for (const perm of permutations(base)) expect(findExactTies(perm).map(ids)).toEqual(expected);
  });
});

describe("groupCoWinners", () => {
  it("groupes consécutifs avec startRank de l'ordre total", () => {
    const groups = groupCoWinners([e("c", 6, 2), e("a", 9, 0), e("b", 6, 2), e("d", 6, 1), e("z", 1, 0)]);
    expect(groups.map(g => [g.startRank, ids(g.members)])).toEqual([[1, ["a"]], [2, ["b", "c"]], [4, ["d"]], [5, ["z"]]]);
  });
  it("les membres portent leur rang de l'ordre total (pas de rang dense)", () => {
    const [first] = groupCoWinners([e("b", 5, 0), e("a", 5, 0)]);
    expect(first.members.map(m => m.rank)).toEqual([1, 2]);
  });
  it("une différence à chaque niveau sépare les groupes", () => {
    expect(groupCoWinners([e("a", 6, 2), e("b", 7, 2)])).toHaveLength(2);
    expect(groupCoWinners([e("a", 6, 2), e("b", 6, 3)])).toHaveLength(2);
    expect(groupCoWinners([e("a", 6, 2, "2026-11-01T00:00:00Z"), e("b", 6, 2, "2026-11-01T00:00:01Z")])).toHaveLength(2);
  });
  it("bigint et number égaux sont regroupés ; liste vide", () => {
    expect(groupCoWinners([e("a", BigInt(4), 1), e("b", 4, 1)])).toHaveLength(1);
    expect(groupCoWinners([])).toEqual([]);
  });
  it("identique pour toutes les permutations, sans muter l'entrée", () => {
    const base = [e("a", 6, 2), e("b", 6, 2), e("c", 6, 2), e("d", 1, 0), e("e", 1, 0)];
    for (const perm of permutations(base)) {
      const copy = [...perm];
      expect(groupCoWinners(perm).map(g => [g.startRank, ids(g.members)])).toEqual([[1, ["a", "b", "c"]], [4, ["d", "e"]]]);
      expect(perm).toEqual(copy);
    }
  });
  it("entrée invalide : RangeError", () => {
    expect(() => groupCoWinners([e("a", -1, 0)])).toThrow(RangeError);
  });
});

describe("selectTopThree", () => {
  it("trois premiers de l'ordre total, sans égalité", () => {
    const r = selectTopThree([e("d", 1, 0), e("a", 9, 0), e("c", 3, 0), e("b", 5, 0)]);
    expect(ids(r.top)).toEqual(["a", "b", "c"]);
    expect(r.top.map(x => x.rank)).toEqual([1, 2, 3]);
    expect(r.coWinnerGroups).toEqual([]);
    expect(r.boundaryTie).toBe(false);
  });
  it("moins de trois entrées, ou aucune", () => {
    expect(ids(selectTopThree([e("a", 1, 0)]).top)).toEqual(["a"]);
    expect(selectTopThree([])).toEqual({ top: [], coWinnerGroups: [], boundaryTie: false });
    expect(selectTopThree([e("a", 1, 0), e("b", 1, 0), e("c", 1, 0)]).boundaryTie).toBe(false);
  });
  it("co-lauréats candidats en tête", () => {
    const r = selectTopThree([e("b", 9, 1), e("a", 9, 1), e("c", 5, 0), e("d", 4, 0)]);
    expect(r.coWinnerGroups.map(g => [g.startRank, ids(g.members)])).toEqual([[1, ["a", "b"]]]);
    expect(r.boundaryTie).toBe(false);
  });
  it("égalité en 2e et 3e place", () => {
    const r = selectTopThree([e("a", 9, 0), e("c", 5, 0), e("b", 5, 0), e("d", 1, 0)]);
    expect(r.coWinnerGroups.map(g => [g.startRank, ids(g.members)])).toEqual([[2, ["b", "c"]]]);
    expect(r.boundaryTie).toBe(false);
  });
  it("égalité 3e/4e : boundaryTie vrai, groupe visible avec le 4e membre, top inchangé (userId)", () => {
    const r = selectTopThree([e("a", 9, 0), e("b", 7, 0), e("d", 5, 0), e("c", 5, 0), e("z", 1, 0)]);
    expect(r.boundaryTie).toBe(true);
    expect(ids(r.top)).toEqual(["a", "b", "c"]);
    expect(r.coWinnerGroups.map(g => [g.startRank, ids(g.members)])).toEqual([[3, ["c", "d"]]]);
  });
  it("égalité 4e/5e seulement : pas de boundaryTie, pas de groupe", () => {
    const r = selectTopThree([e("a", 9, 0), e("b", 7, 0), e("c", 5, 0), e("d", 2, 0), e("e", 2, 0)]);
    expect(r.boundaryTie).toBe(false);
    expect(r.coWinnerGroups).toEqual([]);
  });
  it("égalité à trois niveaux 1re à 4e : boundaryTie vrai", () => {
    const r = selectTopThree([e("a", 3, 0), e("b", 3, 0), e("c", 3, 0), e("d", 3, 0)]);
    expect(r.boundaryTie).toBe(true);
    expect(r.coWinnerGroups.map(g => ids(g.members))).toEqual([["a", "b", "c", "d"]]);
  });
  it("identique pour toutes les permutations", () => {
    const base = [e("a", 9, 0), e("b", 7, 0), e("d", 5, 0), e("c", 5, 0), e("z", 1, 0)];
    const expected = selectTopThree(base);
    for (const perm of permutations(base)) expect(selectTopThree(perm)).toEqual(expected);
  });
  it("entrée invalide : RangeError", () => {
    expect(() => selectTopThree([e("a", 1.5, 0)])).toThrow(RangeError);
  });
});
