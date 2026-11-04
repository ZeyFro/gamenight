const DEFAULT_TEST_ACCOUNT_IDENTIFIERS = ["melah3"];

function normalizedIdentifiers() {
  const configured = (process.env.TOWER_TEST_ACCOUNT_IDENTIFIERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_TEST_ACCOUNT_IDENTIFIERS, ...configured].map((value) => value.toLowerCase()));
}

export function isProductionTowerTestAccount(user: { discordId: string | null; discordName: string }) {
  if (process.env.VERCEL_ENV !== "production") return false;
  const identifiers = normalizedIdentifiers();
  return Boolean(
    (user.discordId && identifiers.has(user.discordId.toLowerCase()))
    || identifiers.has(user.discordName.trim().toLowerCase()),
  );
}
