export const GAME_STYLE_AXES = ["tryharder", "ambianceur", "stratege", "chaos"] as const;

export type GameStyleScores = Record<(typeof GAME_STYLE_AXES)[number], number>;

export function scoreGameStyleQuiz(answers: readonly unknown[]): GameStyleScores | null {
  if (answers.length !== 4 || answers.some((answer) => !GAME_STYLE_AXES.includes(answer as (typeof GAME_STYLE_AXES)[number]))) return null;
  const scores: GameStyleScores = { tryharder: 0, ambianceur: 0, stratege: 0, chaos: 0 };
  for (const answer of answers) scores[answer as keyof GameStyleScores] += 1;
  return scores;
}

export function leadingGameStyles(scores: GameStyleScores): (typeof GAME_STYLE_AXES)[number][] {
  const highest = Math.max(...Object.values(scores));
  return GAME_STYLE_AXES.filter((axis) => scores[axis] === highest);
}
