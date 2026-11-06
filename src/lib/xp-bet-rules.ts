export const XP_BET_MIN = 10;
export const XP_BET_STEP = 10;
export const XP_BET_MAX_RATIO = 0.5;

export function maxBetAmount(xpBalance: number): number {
  return Math.floor((xpBalance * XP_BET_MAX_RATIO) / XP_BET_STEP) * XP_BET_STEP;
}

export function isValidBetAmount(amount: number, xpBalance: number): boolean {
  return Number.isInteger(amount) && amount >= XP_BET_MIN &&
    amount % XP_BET_STEP === 0 && amount <= maxBetAmount(xpBalance);
}
