export type SeasonalTheme = "halloween" | "noel" | "marathon-ete";

export function getSeasonalTheme(date: Date): SeasonalTheme | null {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === 10 && day >= 25 || month === 11 && day === 1) return "halloween";
  if (month === 12 && day >= 20 && day <= 26) return "noel";
  if (month === 7 && day >= 1 && day <= 7) return "marathon-ete";
  return null;
}
