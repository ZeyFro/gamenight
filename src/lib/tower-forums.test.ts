import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchTowerForums } from "./tower-forums";

const calls = vi.hoisted(() => ({
  getCommunity: vi.fn(),
  getMembership: vi.fn(),
  getGuild: vi.fn(),
  getMember: vi.fn(),
  getForums: vi.fn(),
  getActiveThreads: vi.fn(),
  getArchivedThreads: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: calls.getCommunity }));
vi.mock("@/lib/community-access", () => ({ findActiveMembership: calls.getMembership }));
vi.mock("@/lib/discord-rest", () => ({
  getSetupGuild: calls.getGuild,
  getDiscordForumMember: calls.getMember,
  listDiscordForumChannels: calls.getForums,
  listActiveDiscordThreads: calls.getActiveThreads,
  listArchivedDiscordForumThreads: calls.getArchivedThreads,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: calls.rateLimit }));

const guildId = "553922938101825536";
const user = { id: "user-1", discordId: "222222222222222222" };
const channels = ["333333333333333333", "444444444444444444", "555555555555555555"];
const tags = ["666666666666666666", "777777777777777777"];
const ok = (data: unknown) => ({ ok: true, data });

function forum(id: string, name: string, tag: string, tagName: string) {
  return { id, name, type: 15, guild_id: guildId, permission_overwrites: [], available_tags: [{ id: tag, name: tagName }] };
}

function thread(id: string, parent_id: string, name: string, applied_tags: string[] = []) {
  return { id, parent_id, guild_id: guildId, type: 11, name, applied_tags };
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.getCommunity.mockResolvedValue("tower");
  calls.getMembership.mockResolvedValue({ community: { discordGuildId: guildId } });
  calls.getGuild.mockResolvedValue(ok({ id: guildId, roles: [{ id: guildId, permissions: "66560" }] }));
  calls.getMember.mockResolvedValue(ok({ roles: [], pending: false }));
  calls.getForums.mockResolvedValue(ok([
    forum(channels[0], "🔎・recherche-de-joueurs", tags[0], "PC"),
    forum(channels[1], "🛡️・recrutement-équipes", tags[1], "Détente"),
    forum(channels[2], "🌍・projets-et-aventures", "888888888888888888", "Pokémon"),
  ]));
  calls.getActiveThreads.mockResolvedValue(ok([]));
  calls.getArchivedThreads.mockResolvedValue(ok([]));
  calls.rateLimit.mockReturnValue(true);
});

describe("recherche dans les trois forums The Tower", () => {
  it("cherche un titre ou un tag du même forum, ignore les fils privés et déduplique les résultats", async () => {
    const match = thread("111111111111111112", channels[0], "Coop Pokémon", [tags[0], tags[1]]);
    const byTag = thread("111111111111111113", channels[2], "Équipe du vendredi", ["888888888888888888"]);
    calls.getActiveThreads.mockResolvedValue(ok([
      match, byTag,
      thread("111111111111111114", channels[1], "Pokémonlike"),
      thread("111111111111111115", channels[1], "Hades", ["888888888888888888"]),
      { ...match, id: "111111111111111116", type: 12 },
      { ...match, id: "111111111111111117", guild_id: "111111111111111111" },
    ]));
    calls.getArchivedThreads.mockImplementation(({ channelId }) => Promise.resolve(ok(channelId === channels[0] ? [match, byTag] : [])));
    const result = await searchTowerForums(user, "pokemon");
    expect(result).toMatchObject({ status: "ready", forums: [
      { label: "Recherche de joueurs", suggestedTags: expect.arrayContaining(["PC"]), posts: [
        { title: "Coop Pokémon", tags: ["PC"], url: `https://discord.com/channels/${guildId}/${match.id}` },
      ] },
      { label: "Recrutement d’équipes", posts: [] },
      { label: "Projets et aventures", posts: [{ title: "Équipe du vendredi", tags: ["Pokémon"] }] },
    ] });
  });

  it("exclut un forum interdit au membre même si le bot voit le fil", async () => {
    const restricted = {
      ...forum(channels[0], "🔎・recherche-de-joueurs", tags[0], "PC"),
      permission_overwrites: [{ id: user.discordId, type: 1, allow: "0", deny: "1024" }],
    };
    calls.getForums.mockResolvedValue(ok([restricted]));
    calls.getActiveThreads.mockResolvedValue(ok([thread("111111111111111112", channels[0], "Pokémon")]));
    expect(await searchTowerForums(user, "Pokémon")).toEqual({ status: "ready", forums: [] });
    expect(calls.getActiveThreads).not.toHaveBeenCalled();
    expect(calls.getArchivedThreads).not.toHaveBeenCalled();
  });

  it("bloque un membre en attente et un lecteur extérieur à The Tower", async () => {
    calls.getMember.mockResolvedValue(ok({ roles: [], pending: true }));
    expect(await searchTowerForums(user, "Hades")).toEqual({ status: "forbidden" });
    expect(calls.getActiveThreads).not.toHaveBeenCalled();
    calls.getMembership.mockResolvedValue({ community: { discordGuildId: "111111111111111111" } });
    calls.getMember.mockClear();
    expect(await searchTowerForums(user, "Hades")).toEqual({ status: "forbidden" });
    expect(calls.getMember).not.toHaveBeenCalled();
  });

  it("signale une source Discord indisponible sans données partielles", async () => {
    calls.getArchivedThreads.mockResolvedValue({ ok: false, kind: "rate_limited" });
    expect(await searchTowerForums(user, "Hades")).toEqual({ status: "unavailable" });
  });

  it("cherche les archives du bon forum avec les permissions du rôle", async () => {
    const roleId = "999999999999999999";
    calls.getGuild.mockResolvedValue(ok({ id: guildId, roles: [
      { id: guildId, permissions: "1024" },
      { id: roleId, permissions: "65536" },
    ] }));
    calls.getMember.mockResolvedValue(ok({ roles: [roleId], pending: false }));
    calls.getArchivedThreads.mockImplementation(({ channelId }) => Promise.resolve(ok(channelId === channels[1] ? [
      thread("111111111111111118", channels[1], "Du classement sur Hades II", [tags[1]]),
    ] : [])));
    const result = await searchTowerForums(user, "Hades II");
    expect(result).toMatchObject({ status: "ready", forums: [
      { posts: [] },
      { posts: [{ title: "Du classement sur Hades II", tags: ["Détente"] }] },
      { posts: [] },
    ] });
  });

  it("protège le bot contre les recherches répétées", async () => {
    calls.rateLimit.mockReturnValue(false);
    expect(await searchTowerForums(user, "Hades")).toEqual({ status: "rate_limited" });
    expect(calls.getGuild).not.toHaveBeenCalled();
  });
});
