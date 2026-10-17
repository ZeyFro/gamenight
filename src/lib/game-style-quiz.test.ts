import { describe, expect, it } from "vitest";
import { leadingGameStyles, scoreGameStyleQuiz } from "./game-style-quiz";

describe("game style quiz", () => {
  it("scores one point per selected style across the four questions", () => {
    const scores = scoreGameStyleQuiz(["tryharder", "chaos", "tryharder", "stratege"]);
    expect(scores).toEqual({
      tryharder: 2,
      ambianceur: 0,
      stratege: 1,
      chaos: 1,
    });
    expect(scores && leadingGameStyles(scores)).toEqual(["tryharder"]);
  });

  it("rejects missing or forged quiz answers", () => {
    expect(scoreGameStyleQuiz(["tryharder", "ambianceur"])).toBeNull();
    expect(scoreGameStyleQuiz(["tryharder", "ambianceur", "stratege", "admin"])).toBeNull();
  });

  it("reports tied archetypes instead of choosing one arbitrarily", () => {
    const scores = scoreGameStyleQuiz(["tryharder", "ambianceur", "stratege", "chaos"]);
    expect(scores && leadingGameStyles(scores)).toEqual(["tryharder", "ambianceur", "stratege", "chaos"]);
  });
});
