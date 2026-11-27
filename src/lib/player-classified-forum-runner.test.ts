import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  forums: vi.fn(),
  roles: vi.fn(),
  createPost: vi.fn(),
  archive: vi.fn(),
  optIns: vi.fn(),
  ping: vi.fn(),
  hidden: vi.fn(async () => false),
}));
vi.mock("@/lib/player-classified-forum", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/player-classified-forum")>()),
  isForumAuthorHidden: mocks.hidden,
}));

vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({ playerClassified: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } }),
}));
vi.mock("@/lib/discord-rest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord-rest")>()),
  listDiscordForumChannels: mocks.forums,
  listGuildRoles: mocks.roles,
  createForumPost: mocks.createPost,
  archiveThread: mocks.archive,
}));
vi.mock("@/lib/game-ping-optin", () => ({ countGamePingOptIns: mocks.optIns }));
vi.mock("@/lib/notification-policy", () => ({ buildGameRolePing: mocks.ping }));

import { runPlayerClassifiedForumAction } from "./player-classified-forum-runner";

const DEADLINE = new Date(Date.now() + 20_000);
const GUILD = "111111111111111111";
const FORUM = "222222222222222222";
const base = {
  id: "listing-1",
  communityId: "c1",
  message: "Cherche deux joueurs",
  pingedAt: null,
  forumThreadId: null,
  forumClosedAt: null,
  game: { id: "game-1", name: "Hades II" },
  createdBy: { discordId: "333333333333333333", discordName: "alice", profileVisibility: null },
  community: { discordGuildId: GUILD },
};

describe("runPlayerClassifiedForumAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forums.mockResolvedValue({ ok: true, data: [{ id: FORUM, name: "🔎・recherche-de-joueurs", type: 15 }] });
    mocks.roles.mockResolvedValue({ ok: true, data: { roles: [] } });
    mocks.optIns.mockResolvedValue(0);
    mocks.ping.mockReturnValue(null);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("ne crée jamais un second post si le fil est déjà enregistré", async () => {
    mocks.findUnique.mockResolvedValue({ ...base, forumThreadId: "444444444444444444" });
    const result = await runPlayerClassifiedForumAction(
      { intent: "post", listingId: "listing-1", communityId: "c1" }, DEADLINE,
    );
    expect(result).toEqual({ ok: true, data: { threadId: "444444444444444444" } });
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it("ne relaie jamais une annonce dont l'auteur a un profil masqué", async () => {
    mocks.findUnique.mockResolvedValue({ ...base, createdBy: { ...base.createdBy, profileVisibility: { visibility: "HIDDEN" } } });
    const result = await runPlayerClassifiedForumAction(
      { intent: "post", listingId: "listing-1", communityId: "c1" }, DEADLINE,
    );
    expect(result).toEqual({ ok: false, kind: "not_found", message: "Profil masqué : annonce non relayée.", retryable: false });
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("crée un post unique et persiste son identifiant", async () => {
    mocks.findUnique.mockResolvedValue(base);
    mocks.createPost.mockResolvedValue({ ok: true, data: { threadId: "555555555555555555" } });
    const result = await runPlayerClassifiedForumAction(
      { intent: "post", listingId: "listing-1", communityId: "c1" }, DEADLINE,
    );
    expect(result).toEqual({ ok: true, data: { threadId: "555555555555555555" } });
    expect(mocks.createPost).toHaveBeenCalledWith(expect.objectContaining({ forumChannelId: FORUM }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "listing-1", forumThreadId: null }),
      data: expect.objectContaining({ forumThreadId: "555555555555555555" }),
    }));
  });

  it("ferme le post expiré (archivé ET verrouillé) et note la fermeture", async () => {
    mocks.findUnique.mockResolvedValue({ ...base, forumThreadId: "666666666666666666" });
    mocks.archive.mockResolvedValue({ ok: true, data: { threadId: "666666666666666666", archived: true } });
    const result = await runPlayerClassifiedForumAction(
      { intent: "close", listingId: "listing-1", communityId: "c1" }, DEADLINE,
    );
    expect(result).toEqual({ ok: true, data: { threadId: "666666666666666666" } });
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ threadId: "666666666666666666", locked: true }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ forumClosedAt: expect.any(Date) }),
    }));
  });
});
