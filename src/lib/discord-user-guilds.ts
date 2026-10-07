/** OAuth only: a complete snapshot, never a partial list used as authority. */
export async function listOAuthUserGuildIds(accessToken: string): Promise<string[]> {
  const signal = AbortSignal.timeout(8_000);
  const ids = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 25; page++) {
    const url = new URL("https://discord.com/api/v10/users/@me/guilds");
    url.searchParams.set("limit", "200");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (response.status !== 200) throw new Error("Discord guild snapshot unavailable");
    const guilds: unknown = await response.json();
    if (!Array.isArray(guilds) || guilds.length > 200) throw new Error("Invalid Discord guild snapshot");
    const pageIds: string[] = [];
    for (const guild of guilds) {
      if (!guild || typeof guild.id !== "string" || !/^\d{1,20}$/.test(guild.id) ||
          ids.has(guild.id) || (after && BigInt(guild.id) <= BigInt(after))) {
        throw new Error("Incomplete Discord guild snapshot");
      }
      ids.add(guild.id);
      pageIds.push(guild.id);
    }
    if (pageIds.length < 200) return [...ids];
    // Discord's cursor is a snowflake, not the order of items in the JSON.
    after = pageIds.reduce((max, id) => BigInt(id) > BigInt(max) ? id : max);
  }
  throw new Error("Discord guild pagination limit reached");
}
