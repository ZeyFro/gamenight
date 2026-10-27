import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import plan from "@/lib/tower-discord-layout.json";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.admin }));
import { GET, POST } from "./route";

const GUILD = "553922938101825536";
const OWNER = "699223334046531636";
const legacy = plan.archive_candidates[0];
const child = {
  id: "999000000000000002", name: "ancien-salon", type: 0,
  parent_id: legacy.id, permission_overwrites: [
    { id: "999000000000000003", type: 0, allow: "1024", deny: "0" },
  ],
};

describe("The Tower: archives en lecture seule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_BOT_TOKEN", "fake-test-token");
    mocks.user.mockResolvedValue({ id: "owner" });
    mocks.admin.mockResolvedValue({ discordId: OWNER });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("refuse les utilisateurs non propriétaires sans requête Discord", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fournit au propriétaire une prévisualisation et sauvegarde sans écrire", async () => {
    const channels = [
      ...plan.archive_candidates.map(c => ({
        id: c.id, name: c.name, type: 4, parent_id: null, permission_overwrites: [],
      })),
      child,
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(channels));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mode).toBe("read-only");
    expect(body.writeEnabled).toBe(false);
    expect(body.preview).toEqual([{ id: child.id, name: child.name, source: legacy.name }]);
    expect(body.backup.channels[0].permission_overwrites).toEqual(child.permission_overwrites);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });

  it("bloque toute mutation Discord même avec une confirmation propriétaire", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(new NextRequest("http://localhost/api/admin/tower-archive", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ guildId: GUILD, confirm: "ARCHIVER_THE_TOWER_SANS_SUPPRIMER", fingerprint: "test" }),
    }));
    expect(response.status).toBe(423);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
