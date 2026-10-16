import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlayerCountCompatible } from "@/lib/player-count";
import { isRoulettePlayerFilterEnabled, pickInstantSegment, pickRouletteCandidate, pickWeightedRouletteCandidate, type DrawCandidate } from "@/lib/roulette-draw";

const c = (id: string, minPlayers: number | null, maxPlayers: number | null): DrawCandidate & { id: string } => ({
  id,
  minPlayers,
  maxPlayers,
});
// rng déterministe : renvoie toujours la valeur donnée (dans [0,1[).
const at = (v: number) => () => v;

afterEach(() => vi.unstubAllEnvs());

describe("isPlayerCountCompatible", () => {
  it("min absent = 2, max absent = pas de plafond", () => {
    expect(isPlayerCountCompatible(null, null, 2)).toBe(true);
    expect(isPlayerCountCompatible(null, null, 1)).toBe(false);
    expect(isPlayerCountCompatible(null, null, 40)).toBe(true);
  });
  it("bornes incluses", () => {
    expect(isPlayerCountCompatible(3, 5, 2)).toBe(false);
    expect(isPlayerCountCompatible(3, 5, 3)).toBe(true);
    expect(isPlayerCountCompatible(3, 5, 5)).toBe(true);
    expect(isPlayerCountCompatible(3, 5, 6)).toBe(false);
  });
});

describe("isRoulettePlayerFilterEnabled", () => {
  it("exactement `true`", () => {
    expect(isRoulettePlayerFilterEnabled()).toBe(false);
    vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "1");
    expect(isRoulettePlayerFilterEnabled()).toBe(false);
    vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
    expect(isRoulettePlayerFilterEnabled()).toBe(true);
  });
});

describe("pickRouletteCandidate", () => {
  const list = [c("a", 2, 2), c("b", 4, 6), c("c", null, null)];

  it("filtre éteint : tout est tirable, jamais de repli", () => {
    const r = pickRouletteCandidate(list, { playerCount: 5, filterEnabled: false, rng: at(0) });
    expect(r).toEqual({ chosen: list[0], fallback: false });
  });
  it("filtre allumé : ne garde que les jeux compatibles (une seule compatible)", () => {
    const only = [c("a", 2, 2), c("b", 4, 6), c("x", 7, 8)];
    const r = pickRouletteCandidate(only, { playerCount: 5, filterEnabled: true, rng: at(0.99) });
    expect(r).toEqual({ chosen: only[1], fallback: false });
  });
  it("jeu sans min/max compatible à partir de 2 joueurs", () => {
    const r = pickRouletteCandidate(list, { playerCount: 3, filterEnabled: true, rng: at(0.99) });
    expect(r.chosen).toBe(list[2]);
  });
  it("aléa injectable : choisit l'index floor(rng * n)", () => {
    const r = pickRouletteCandidate(list, { playerCount: 2, filterEnabled: true, rng: at(0.99) });
    expect(r.chosen).toBe(list[2]); // a et c compatibles à 2
    expect(pickRouletteCandidate(list, { playerCount: 2, filterEnabled: true, rng: at(0) }).chosen).toBe(list[0]);
  });
  it("aucune compatible : repli sur tous et signalé", () => {
    const r = pickRouletteCandidate([c("a", 2, 2), c("b", 4, 6)], { playerCount: 3, filterEnabled: true, rng: at(0.99) });
    expect(r).toEqual({ chosen: expect.objectContaining({ id: "b" }), fallback: true });
  });
  it("aucun candidat : chosen null", () => {
    expect(pickRouletteCandidate([], { playerCount: 3, filterEnabled: true, rng: at(0) })).toEqual({ chosen: null, fallback: false });
  });
});

describe("pickWeightedRouletteCandidate", () => {
  const candidates = [
    { ...c("low", null, null), weight: 1, recentlyPlayed: false },
    { ...c("high", null, null), weight: 5, recentlyPlayed: false },
    { ...c("recent", null, null), weight: 100, recentlyPlayed: true },
  ];

  it("pondère les jeux selon leur tierlist", () => {
    expect(pickWeightedRouletteCandidate(candidates.slice(0, 2), { playerCount: 2, filterEnabled: false, rng: at(0.5) }).chosen).toBe(candidates[1]);
  });
  it("écarte un jeu récent quand un candidat reposé existe", () => {
    expect(pickWeightedRouletteCandidate(candidates, { playerCount: 2, filterEnabled: false, rng: at(0.99) }).chosen).toBe(candidates[1]);
  });
  it("garde les jeux récents si tous les candidats le sont", () => {
    expect(pickWeightedRouletteCandidate(candidates.slice(2), { playerCount: 2, filterEnabled: false, rng: at(0) }).chosen).toBe(candidates[2]);
  });
  it("préserve le fallback joueur quand aucun jeu n'est compatible", () => {
    const incompatible = [{ ...c("a", 8, 10), weight: 1, recentlyPlayed: false }];
    expect(pickWeightedRouletteCandidate(incompatible, { playerCount: 2, filterEnabled: true, rng: at(0) })).toEqual({ chosen: incompatible[0], fallback: true });
  });
});

describe("pickInstantSegment (roulette instantanée, « Relancer »)", () => {
  const seg = (gameId: string, min: number | null = null, max: number | null = null) => ({ gameId, minPlayers: min, maxPlayers: max });
  const segments = [seg("a"), seg("b"), seg("a"), seg("c")]; // « a » proposé 2 fois

  it("exclut TOUS les segments d'un jeu déjà tiré, renvoie l'index d'origine", () => {
    const r = pickInstantSegment(segments, { drawnGameIds: new Set(["a"]), playerCount: 2, filterEnabled: true, rng: at(0) });
    expect(r).toEqual({ index: 1, fallback: false, exhausted: false });
    expect(pickInstantSegment(segments, { drawnGameIds: new Set(["a"]), playerCount: 2, filterEnabled: true, rng: at(0.99) }).index).toBe(3);
  });
  it("flag éteint : jeux déjà tirés ignorés, tirage uniforme comme à l'origine", () => {
    const r = pickInstantSegment(segments, { drawnGameIds: new Set(["a", "b", "c"]), playerCount: 2, filterEnabled: false, rng: at(0) });
    expect(r).toEqual({ index: 0, fallback: false, exhausted: false });
  });
  it("tous tirés : exhausted, aucun index", () => {
    const r = pickInstantSegment(segments, { drawnGameIds: new Set(["a", "b", "c"]), playerCount: 2, filterEnabled: true, rng: at(0) });
    expect(r).toEqual({ index: null, fallback: false, exhausted: true });
  });
  it("combine filtre et exclusion ; repli parmi les non tirés", () => {
    const list = [seg("a", 2, 2), seg("b", 4, 6), seg("c", 4, 6)];
    expect(pickInstantSegment(list, { drawnGameIds: new Set(["b"]), playerCount: 5, filterEnabled: true, rng: at(0) })).toEqual({ index: 2, fallback: false, exhausted: false });
    expect(pickInstantSegment(list, { drawnGameIds: new Set(["b", "c"]), playerCount: 5, filterEnabled: true, rng: at(0) })).toEqual({ index: 0, fallback: true, exhausted: false });
  });
});
