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
const channels: Array<{ id: string; name: string; type: number; parent_id: string | null;
  permission_overwrites: Array<{ id: string; type: number; allow: string; deny: string }> }> = [
  { id: protectedCategory.id, name: "staff", type: 4, parent_id: null, permission_overwrites: [] },
  { id: "999000000000000002", name: "ticket-logs", type: 0, parent_id: protectedCategory.id,
    permission_overwrites: [{ id: "999000000000000009", type: 1, allow: "1024", deny: "0" }] },
  { id: "999000000000000003", name: "discussion", type: 0, parent_id: null, permission_overwrites: [] },
  { id: "999000000000000004", name: "vocal", type: 2, parent_id: null, permission_overwrites: [] },
];
const request = (page = "0") => new NextRequest("http://localhost/api/admin/tower-content-audit?page=" + page);

function discordMock(guildStatus = 200, unreadable = false, inventory = channels) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/guilds/" + GUILD + "/channels"))
      return guildStatus === 200 ? Response.json(inventory) : Response.json({ message: "Forbidden" }, { status: guildStatus });
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
    expect(body.channels[0]).toMatchObject({sampleSkipped:true,skipReason:"sensitive_channel",sampledMessages:0});
    expect(body.channels[1].botNames).toContain("BotExistant");
    expect(body.channels[1].serviceEvidence).toContain("ticket");
    expect(fetcher.mock.calls.some(c=>String(c[0]).includes("/channels/"+channels[1].id+"/messages"))).toBe(false);
    expect(fetcher.mock.calls.some(c=>String(c[0]).includes("/channels/"+channels[1].id+"/pins"))).toBe(false);
    const json = JSON.stringify(body);
    expect(json).not.toContain("texte-prive-ne-pas-exporter");
    expect(json).not.toContain("UtilisateurPrive");
    expect(fetcher.mock.calls.every(c => c[1]?.method === undefined)).toBe(true);
  });

  it("ne présente pas un refus d'accès à l'inventaire comme un serveur vide", async () => {
    discordMock(403);
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect((await response.json()).discordStatus).toBe(403);
  });

  it.each([0, 1])("ne lit jamais un salon à permissions particulières hors des catégories connues (type %s)", async type => {
    const privateChannel = { id: "999000000000000005", name: "conversation", type: 0, parent_id: null,
      permission_overwrites: [{ id: type === 0 ? GUILD : "999000000000000009", type, allow: "1024", deny: "0" }] };
    const fetcher = discordMock(200, false, [...channels, privateChannel]);
    const body = await (await GET(request())).json();
    expect(body.inventory.find((x: {id:string}) => x.id === privateChannel.id).protected).toBe(true);
    expect(body.channels.find((x: {id:string}) => x.id === privateChannel.id))
      .toMatchObject({ sampleSkipped: true, topic: "", recentContentPatterns: [] });
    expect(fetcher.mock.calls.some(c => String(c[0]).includes("/channels/" + privateChannel.id + "/"))).toBe(false);
  });

  it("protège les enfants d’une nouvelle catégorie à permissions particulières", async () => {
    const category = { id: "999000000000000005", name: "autre", type: 4, parent_id: null,
      permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: "1024" }] };
    const child = { id: "999000000000000006", name: "conversation", type: 0, parent_id: category.id, permission_overwrites: [] };
    const fetcher = discordMock(200, false, [...channels, category, child]);
    const body = await (await GET(request())).json();
    expect(body.channels.find((x: {id:string}) => x.id === child.id).sampleSkipped).toBe(true);
    expect(fetcher.mock.calls.some(c => String(c[0]).includes("/channels/" + child.id + "/"))).toBe(false);
  });

  it("signale explicitement les salons dont les messages sont illisibles", async () => {
    discordMock(200, true);
    const body = await (await GET(request())).json();
    expect(body.unreadableChannels).toHaveLength(1);
    expect(body.unreadableChannels[0].messageReadStatus).toBe(403);
    expect(body.channels[0].sampleSkipped).toBe(true);
  });

  it("rejette une pagination invalide sans appeler Discord", async () => {
    const fetcher = discordMock();
    expect((await GET(request("-1"))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
