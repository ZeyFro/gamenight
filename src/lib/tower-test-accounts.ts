export function isProductionTowerTestAccount(user: { discordId: string | null }) {
  if (process.env.VERCEL_ENV !== "production" || !user.discordId) return false;
  return (process.env.TOWER_TEST_ACCOUNT_IDENTIFIERS ?? "")
    .split(",")
    .map(value => value.trim())
    .some(value => /^[0-9]{17,20}$/.test(value) && value === user.discordId);
}
