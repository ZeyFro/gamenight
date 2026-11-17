import { describe, expect, it } from "vitest";
import { parseGameEpitaph } from "./community-game-graveyard-input";
import * as m_p08 from "./community-game-graveyard-input";

describe("cimetière : saisie", () => {
  it("nettoie l’identifiant et l’épitaphe sans interpréter le texte", () => {
    expect(parseGameEpitaph(" game ", "  Ci-gît\n<script>notre backlog</script> ")).toEqual({ gameId: "game", epitaph: "Ci-gît\n<script>notre backlog</script>" });
  });
  it.each([
    [null, "texte"], ["jeu", new File([], "epitaphe.txt")], [" ", "texte"], ["jeu", " "],
    ["x".repeat(101), "texte"], ["jeu", "x".repeat(1001)],
  ])("refuse une saisie invalide %s", (gameId, epitaph) => {
    expect(parseGameEpitaph(gameId, epitaph)).toBeNull();
  });
  it("accepte les bornes exactes", () => {
    expect(parseGameEpitaph("x".repeat(100), "x".repeat(1000))).not.toBeNull();
  });
});

// Tâche Qwen qwen-p08-epitaphe-saisie — repris du test de preuve loop/checks (node:test) sous vitest.
describe("community-game-graveyard-input · p08-epitaphe-saisie", () => {
  it('le comportement existant est conserve', () => {
    expect(m_p08.parseGameEpitaph('clx123abc', 'Repose en paix')).toEqual({ gameId: 'clx123abc', epitaph: 'Repose en paix' });
    expect(m_p08.parseGameEpitaph('  game-1_b  ', ' GG ')).toEqual({ gameId: 'game-1_b', epitaph: 'GG' });
    expect(m_p08.parseGameEpitaph('', 'x')).toBe(null);
    expect(m_p08.parseGameEpitaph('g', '   ')).toBe(null);
    expect(m_p08.parseGameEpitaph(5, 'x')).toBe(null);
    expect(m_p08.parseGameEpitaph('g', 'x'.repeat(1001))).toBe(null);
    expect(m_p08.parseGameEpitaph('g', 'x'.repeat(1000))!.epitaph.length).toBe(1000);
  });
  it('un identifiant de jeu avec des caracteres non autorises est refuse', () => {
    for (const id of ['../etc', 'game id', 'a/b', 'a?b', 'a'.repeat(101), 'jeu\nx', 'é']) expect(m_p08.parseGameEpitaph(id, 'x')).toBe(null);
    expect(m_p08.parseGameEpitaph('a'.repeat(100), 'x')).toBeTruthy();
  });
  it('l\'epitaphe normalise les fins de ligne et limite les lignes vides', () => {
    expect(m_p08.parseGameEpitaph('g1', ' Repose en paix\r\n\r\n\r\nGG  ')).toEqual({ gameId: 'g1', epitaph: 'Repose en paix\n\nGG' });
  });
});

// Identifiants réels : Game.id vaut cuid() par défaut (prisma/schema.prisma) ; les scripts de recette utilisent des ids lisibles.
describe("parseGameEpitaph · format réel de gameId", () => {
  it("accepte un cuid réel, un id lisible et des séparateurs usuels", () => {
    for (const gameId of ["cm0abc123def456ghi789jkl0", "linked-game", "steam:123456", "igdb.987", "Game_1-b"]) {
      expect(parseGameEpitaph(gameId, "Repose en paix")).toEqual({ gameId, epitaph: "Repose en paix" });
    }
  });
  it("refuse espaces, retours à la ligne, vide et plus de 100 caractères", () => {
    for (const gameId of ["a b", "a\nb", "", "   ", "x".repeat(101), "a/b", "a;b"]) {
      expect(parseGameEpitaph(gameId, "Repose en paix")).toBeNull();
    }
    expect(parseGameEpitaph("x".repeat(100), "ok")).not.toBeNull();
  });
});
