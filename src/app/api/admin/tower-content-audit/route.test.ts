import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import plan from "@/lib/tower-discord-layout.json";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.admin }));
import { GET } from "./route";

const GUILD = "553922938101825536";
const OWNER = "699223334046531636";
const protectedCategory = plan.protected_categories[0];
const channels = [
  { id: protectedCategory.id, name: "staff", type: 4, parent_id: null, permission_overwrites: [] },
  { id: "999000000000000002", name: "ticket-logs", type: 0, parent_id: protectedCategory.id,
    permission_overwrites: [{ id: "999000000000000009", type: 1, allow: "1024", deny: "0" }] },
  { id: "999000000000000003", name: "discussion", type: 0, parent_id: null, permission_overwrites: [] },
  { id: "999000000000000004", name: "vocal", type: 2, parent_id: null, permission_overwrites: [] },
];
const request = (page = "0") => new NextRequest("http://localhost/api/admin/tower-content-audit?page=" + page);

function discordMock(guildStatus = 200, unreadable = false) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/guilds/" + GUILD + "/channels"))
      return guildStatus === 200 ? Response.json(channels) : Response.json({ message: "Forbidden" }, { status: guildStatus });
    if (url.includes("/messages?limit=30")) {
      if (unreadable) return Response.json({ message: "Forbidden" }, { status: 403 });
      return Response.json([
        { id: "1", content: "Tickets et sanctions déjà gérés", timestamp: "2026-10-27T11:00:00Z",
          author: { bot: true, username: "BotExistant" } },
        { id: "2", content: "texte-prive-ne-pas-exporter", timestamp: "2026-10-27T10:00:00Z",
          author: { bot: false, username: "UtilisateurPrive" } },
      ]);
    }
    if (url.endsWith("/pins")) return Response.json([]);
    throw Error("Unexpected URL " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("The Tower: inventaire de lecture seule et protection des historiques", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_BOT_TOKEN", "fake-test-token");
    mocks.user.mockResolvedValue({ id: "owner" });
    mocks.admin.mockResolvedValue({ discordId: OWNER });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("interdit l'accès aux non-propriétaires avant toute requête Discord", async () => {
    const fetcher = discordMock();
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("inventorie aussi les vocaux et catégories, marque les permissions sensibles et ne renvoie aucun message brut", async () => {
    const fetcher = discordMock();
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalGuildChannels).toBe(4);
    expect(body.totalTextChannels).toBe(2);
    expect(body.inventory).toHaveLength(4);
    expect(body.inventory.find((x: {id:string}) => x.id === channels[1].id))
      .toMatchObject({ protected: true, hasMemberOverwrites: true, overwriteCount: 1 });
    expect(body.inventory.find((x: {id:string}) => x.id === channels[3].id).type).toBe(2);
    expect(body.channels[0].botNames).toContain("BotExistant");
    expect(body.channels[0].serviceEvidence).toContain("ticket");
    const json = JSON.stringify(body);
    expect(json).not.toContain("texte-prive-ne-pas-exporter");
    expect(json).not.toContain("UtilisateurPrive");
    expect(fetcher.mock.calls.every(c => c.length === 1)).toBe(true);
  });

  it("ne présente pas un refus d'accès à l'inventaire comme un serveur vide", async () => {
    discordMock(403);
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect((await response.json()).discordStatus).toBe(403);
  });

  it("signale explicitement les salons dont les messages sont illisibles", async () => {
    discordMock(200, true);
    const body = await (await GET(request())).json();
    expect(body.unreadableChannels).toHaveLength(2);
    expect(body.unreadableChannels[0].messageReadStatus).toBe(403);
  });

  it("rejette une pagination invalide sans appeler Discord", async () => {
    const fetcher = discordMock();
    expect((await GET(request("-1"))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
