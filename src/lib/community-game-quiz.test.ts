import { describe, expect, it } from "vitest";
import { buildCommunityGameQuizRound, isCorrectGameAnswer, normalizeGameAnswer, type CommunityQuizGame } from "./community-game-quiz";
import * as m_p04 from "./community-game-quiz";

const game = (name: string, details: CommunityQuizGame["details"]): CommunityQuizGame => ({
  name,
  details,
});

describe("community game quiz", () => {
  it("chooses only a community game with three useful cached clues", () => {
    const round = buildCommunityGameQuizRound([
      game("Sans indices", null),
      game("Stardew Valley", {
        igdbId: 1, name: "Stardew Valley", summary: null, descriptionFr: null, totalRating: null,
        coverUrl: null, screenshotUrls: [], youtubeVideoIds: [], platforms: ["PC"], isCoop: false, maxPlayersFromModes: null, genres: ["Role-playing"],
        themes: ["Comedy"], releaseDate: "2016-02-26", developers: ["ConcernedApe"], publishers: [],
      }),
    ], () => 0);

    expect(round).toMatchObject({
      answer: "Stardew Valley",
      clues: ["Genre : Role-playing", "Thème : Comedy", "Studio : ConcernedApe"],
    });
  });

  it("returns no round when the community has no game with three clues", () => {
    expect(buildCommunityGameQuizRound([game("Incomplet", {
      igdbId: 2, name: "Incomplet", summary: null, descriptionFr: null, totalRating: null,
      coverUrl: null, screenshotUrls: [], youtubeVideoIds: [], platforms: [], isCoop: false, maxPlayersFromModes: null, genres: ["Puzzle"],
      themes: [], releaseDate: null, developers: [], publishers: [],
    })])).toBeNull();
  });

  it("accepts accents and punctuation variants in guesses", () => {
    expect(normalizeGameAnswer("Le Café! 2")).toBe(normalizeGameAnswer("le cafe-2"));
    expect(isCorrectGameAnswer("Le Café! 2", "le cafe-2")).toBe(true);
    expect(isCorrectGameAnswer("Autre jeu", "le cafe-2")).toBe(false);
  });
});

// Tâche Qwen qwen-p04-quiz-article — repris du test de preuve loop/checks (node:test) sous vitest.
describe("community-game-quiz · p04-quiz-article", () => {
  it('un article initial est tolere des deux cotes', () => {
    expect(m_p04.isCorrectGameAnswer('witcher 3', 'The Witcher 3')).toBeTruthy();
    expect(m_p04.isCorrectGameAnswer('The Witcher 3', 'Witcher 3')).toBeTruthy();
    expect(m_p04.isCorrectGameAnswer("l'Odyssée", 'Odyssée')).toBeTruthy();
    expect(m_p04.isCorrectGameAnswer('Seigneur des Anneaux', 'Le Seigneur des Anneaux')).toBeTruthy();
  });
  it('un article seul reste une reponse et le comportement existant est conserve', () => {
    expect(m_p04.isCorrectGameAnswer('The', 'the')).toBeTruthy();
    expect(!m_p04.isCorrectGameAnswer('the', 'witcher')).toBeTruthy();
    expect(m_p04.isCorrectGameAnswer('ZELDA', 'zelda')).toBeTruthy();
    expect(!m_p04.isCorrectGameAnswer('Zelda', 'Mario')).toBeTruthy();
    expect(m_p04.normalizeGameAnswer('Pokémon: Rouge!')).toBe('pokemon rouge');
  });
});
