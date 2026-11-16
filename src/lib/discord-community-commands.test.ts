import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  badgeCount: vi.fn(),
  gameCount: vi.fn(),
  teams: vi.fn(),
  stats: vi.fn(),
  tower: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
    userBadge: { count: mocks.badgeCount },
    userGame: { count: mocks.gameCount },
    communityTeamMember: { findMany: mocks.teams },
  },
}));
vi.mock("@/lib/member-stats", () => ({ getMemberStats: mocks.stats }));
vi.mock("@/lib/tower-personal-progress", () => ({ getTowerPersonalProgress: mocks.tower }));

import { loadCommunityProfile } from "./discord-community-profile";
import { buildHelpContent, handleSignedCommunityInteraction, renderProfile } from "./discord-community-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const USER = "100000000000000004";

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "");
  vi.stubEnv("DISCORD_PROFILE_COMMAND_ENABLED", "");
  vi.stubEnv("DISCORD_BOOSTER_ENABLED", "");
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "");
  vi.stubEnv("COMMUNITY_SETUP_COMMAND_ENABLED", "");
  vi.stubEnv("VERCEL_ENV", "");
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower", towerLevelsPerFloor: 10 });
  mocks.user.mockResolvedValue({ id: "user-1", discordName: "Maxime" });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.badgeCount.mockResolvedValue(7);
  mocks.gameCount.mockResolvedValue(42);
  mocks.teams.mockResolvedValue([]);
  mocks.stats.mockResolvedValue({ xpTotal: 800, streakCount: 0, streakLastActiveAt: null, bestStreakCount: 0, tournamentsParticipatedCount: 0 });
  mocks.tower.mockResolvedValue({ status: "PROGRESS", floorsClimbed: "12", completedSeasons: 1, rank: { name: "X" }, next: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("/aide", () => {
  it("reflète l'état réel des variables, sans promettre une commande inactive", () => {
    const off = buildHelpContent({} as NodeJS.ProcessEnv);
    expect(off).toContain("/role");
    expect(off).toContain("en attente d’activation");
    expect(off).not.toContain("actif");

    const on = buildHelpContent({
      DISCORD_ROLE_COMMAND_ENABLED: "true",
      TOWER_CHALLENGES_ENABLED: "true",
      DISCORD_PROFILE_COMMAND_ENABLED: "true",
      COMMUNITY_SETUP_COMMAND_ENABLED: "true",
      DISCORD_BOOSTER_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(on).toContain("actif");
    expect(on).not.toContain("en attente d’activation");
    expect(on).toContain("Aucune commande ne donne de permission administrative");
  });

  it("répond en privé et ne dépend d'aucune activation", () => {
    const output = handleSignedCommunityInteraction(
      {
        type: 2,
        id: "100000000000000030",
        application_id: APP,
        token: "token",
        guild_id: GUILD,
        member: { user: { id: USER, username: "maxime", bot: false } },
        data: { name: "aide" },
      },
      String(Math.floor(Date.now() / 1000))
    );
    expect(output.status).toBe(200);
    expect(output.body).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(JSON.stringify(output.body)).toContain("/profil");
    expect(output.runCommunity).toBeUndefined();
  });

  it("refuse un MP, un horodatage ancien ou une autre application", () => {
    const base = {
      type: 2,
      id: "100000000000000030",
      application_id: APP,
      token: "token",
      member: { user: { id: USER, username: "maxime" } },
      data: { name: "aide" },
    };
    const now = String(Math.floor(Date.now() / 1000));
    expect(JSON.stringify(handleSignedCommunityInteraction(base, now).body)).toContain("dans le serveur");
    expect(handleSignedCommunityInteraction({ ...base, guild_id: GUILD }, String(Number(now) - 400)).status).toBe(400);
    expect(handleSignedCommunityInteraction({ ...base, guild_id: GUILD, application_id: "100000000000000099" }, now).status).toBe(400);
  });
});

describe("/profil", () => {
  const body = {
    type: 2,
    id: "100000000000000031",
    application_id: APP,
    token: "token-profil",
    guild_id: GUILD,
    member: { user: { id: USER, username: "maxime", bot: false } },
    data: { name: "profil" },
  };

  it("reste fermée par défaut", async () => {
    const output = handleSignedCommunityInteraction(body, String(Math.floor(Date.now() / 1000)));
    expect(JSON.stringify(output.body)).toContain("pas encore ouverte");
    expect(output.runCommunity).toBeUndefined();
    expect(mocks.community).not.toHaveBeenCalled();
  });

  it("acquitte puis publie le profil en privé", async () => {
    vi.stubEnv("DISCORD_PROFILE_COMMAND_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", channel_id: "2" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const output = handleSignedCommunityInteraction(body, String(Math.floor(Date.now() / 1000)));
    expect(output.body).toMatchObject({ type: 5 });
    await output.runCommunity?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)) as { content: string };
    expect(sent.content).toContain("Maxime");
    expect(sent.content).toContain("Étage **1**");
    expect(sent.content).not.toContain(USER);
  });
});

describe("chargement du profil communautaire", () => {
  it("refuse un identifiant invalide, un serveur inconnu et un non-membre", async () => {
    expect((await loadCommunityProfile({ guildId: "abc", discordId: USER })).status).toBe("INVALID");
    mocks.community.mockResolvedValue(null);
    expect((await loadCommunityProfile({ guildId: GUILD, discordId: USER })).status).toBe("NOT_MEMBER");
    mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower", towerLevelsPerFloor: 10 });
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    expect((await loadCommunityProfile({ guildId: GUILD, discordId: USER })).status).toBe("NOT_MEMBER");
  });

  it("réutilise le barème XP existant et n'affiche pas d'étages de défi quand Tower est éteint", async () => {
    const result = await loadCommunityProfile({ guildId: GUILD, discordId: USER });
    expect(result.status).toBe("PROFILE");
    if (result.status !== "PROFILE") return;
    expect(result.profile.level).toBe(5);
    expect(result.profile.floor).toBe(1);
    expect(result.profile.floorsWon).toBeNull();
    expect(mocks.tower).not.toHaveBeenCalled();
    expect(result.profile.badges).toBe(7);
    expect(result.profile.games).toBe(42);
  });

  it("ajoute les étages gagnés et les équipes quand Tower est actif", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    mocks.teams.mockResolvedValue([
      { team: { name: "Paped", createdById: "user-1", maxMembers: 8, game: { name: "Deep Rock Galactic" }, _count: { members: 6 } } },
    ]);
    const result = await loadCommunityProfile({ guildId: GUILD, discordId: USER });
    expect(result.status).toBe("PROFILE");
    if (result.status !== "PROFILE") return;
    expect(result.profile.floorsWon).toBe("12");
    expect(result.profile.teams).toEqual([
      { name: "Paped", game: "Deep Rock Galactic", captain: true, members: 6, maxMembers: 8 },
    ]);
    const content = renderProfile(result.profile);
    expect(content).toContain("Étages gagnés par les défis : 12");
    expect(content).toContain("**Paped** (Deep Rock Galactic) · capitaine · 6/8");
  });

  it("n'affiche ni identifiant Discord ni donnée privée", async () => {
    const result = await loadCommunityProfile({ guildId: GUILD, discordId: USER });
    if (result.status !== "PROFILE") throw new Error("profil attendu");
    const content = renderProfile(result.profile);
    expect(content).not.toContain(USER);
    expect(content).not.toContain("token");
    expect(content).toContain("Équipes : aucune pour le moment.");
  });
});

describe("/boost", () => {
  const body = {
    type: 2,
    id: "100000000000000032",
    application_id: APP,
    token: "token-boost",
    guild_id: GUILD,
    member: { user: { id: USER, username: "maxime", bot: false } },
    data: { name: "boost" },
  };
  const now = () => String(Math.floor(Date.now() / 1000));
  const reply = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

  it("reste fermée par défaut, sans aucun appel Discord", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const output = handleSignedCommunityInteraction(body, now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouverts");
    expect(output.runCommunity).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lit le statut Booster à la source Discord et le publie en privé", async () => {
    vi.stubEnv("DISCORD_BOOSTER_ENABLED", "true");
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      if ((init?.method ?? "GET").toUpperCase() === "PATCH") return reply({ id: "1", channel_id: "2" });
      return reply({ roles: [], premium_since: "2026-11-01T10:00:00.000+00:00" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const output = handleSignedCommunityInteraction(body, now());
    expect(output.body).toMatchObject({ type: 5 });
    await output.runCommunity?.();
    const patched = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "").toUpperCase() === "PATCH");
    expect(patched).toBeDefined();
    const content = JSON.parse(String((patched![1] as { body: string }).body)).content as string;
    expect(content).toContain("Avantages Booster actifs");
    expect(content).toMatch(/<t:\d+:D>/);
  });

  it("signale un membre qui ne booste pas, sans supprimer de données", async () => {
    vi.stubEnv("DISCORD_BOOSTER_ENABLED", "true");
    const fetchMock = vi.fn(async (_input: unknown, init?: { method?: string }) =>
      (init?.method ?? "GET").toUpperCase() === "PATCH" ? reply({ id: "1", channel_id: "2" }) : reply({ roles: [], premium_since: null })
    );
    vi.stubGlobal("fetch", fetchMock);
    const output = handleSignedCommunityInteraction(body, now());
    await output.runCommunity?.();
    const patched = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "").toUpperCase() === "PATCH");
    const content = JSON.parse(String((patched![1] as { body: string }).body)).content as string;
    expect(content).toContain("ne boosts pas");
    expect(content).toContain("restent intactes");
  });

  it("n'affirme jamais qu'un membre ne booste pas quand Discord échoue", async () => {
    vi.stubEnv("DISCORD_BOOSTER_ENABLED", "true");
    const fetchMock = vi.fn(async (_input: unknown, init?: { method?: string }) => {
      if ((init?.method ?? "GET").toUpperCase() === "PATCH") return reply({ id: "1", channel_id: "2" });
      return new Response(JSON.stringify({ message: "Unknown Member", code: 10007 }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const output = handleSignedCommunityInteraction(body, now());
    await output.runCommunity?.();
    const patched = fetchMock.mock.calls.find((call) => (call[1]?.method ?? "").toUpperCase() === "PATCH");
    const content = JSON.parse(String((patched![1] as { body: string }).body)).content as string;
    expect(content).toContain("Impossible de vérifier");
    expect(content).not.toContain("ne boosts pas");
  });
});
