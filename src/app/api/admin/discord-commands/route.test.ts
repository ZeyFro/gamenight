import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdmin() }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));

import { POST } from "./route";

// Valeurs fictives : si l'une d'elles apparaît dans une réponse ou un journal, c'est une fuite.
const TOKEN = "TOKEN-FICTIF-NE-DOIT-JAMAIS-SORTIR";
const SECRET = "SECRET-FICTIF-DE-ROUTE";
const CLIENT_ID = "123456789012345678";
const GUILD_ID = "553922938101825536";
const ENDPOINT = `https://discord.com/api/v10/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;
const fetchMock = vi.fn();

function call(body: unknown = { mode: "check" }, headers: Record<string, string> = { "x-registration-secret": SECRET }) {
  return POST(
    new Request("https://example.test/api/admin/discord-commands", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function discordOk(installed: object[] = []) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? new Response("{}", { status: 200 }) : new Response(JSON.stringify(installed), { status: 200 })
  );
}

beforeEach(() => {
  // Un administrateur différent à chaque appel : la limite de débit est testée à part.
  requireAdmin.mockReset().mockImplementation(async () => ({ id: `admin-${Math.random()}` }));
  fetchMock.mockReset();
  logger.info.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DISCORD_COMMAND_REGISTRATION_ENABLED", "true");
  vi.stubEnv("DISCORD_COMMAND_REGISTRATION_SECRET", SECRET);
  vi.stubEnv("DISCORD_BOT_TOKEN", TOKEN);
  vi.stubEnv("DISCORD_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", GUILD_ID);
  vi.stubEnv("VERCEL_ENV", "production");
  discordOk();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/admin/discord-commands : refus", () => {
  it("interrupteur éteint (absent, vide, « TRUE », « 1 ») : 404, même avec admin et secret corrects, aucun appel Discord", async () => {
    for (const value of [undefined, "", "TRUE", "1", "false"]) {
      if (value === undefined) vi.stubEnv("DISCORD_COMMAND_REGISTRATION_ENABLED", "");
      else vi.stubEnv("DISCORD_COMMAND_REGISTRATION_ENABLED", value);
      const response = await call();
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("Preview : 404 sans appel Discord", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await call()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("secret du serveur absent ou vide : 404 (jamais ouverte par défaut)", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("DISCORD_COMMAND_REGISTRATION_SECRET", value);
      expect((await call()).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sans en-tête de secret : 401, sans appel Discord", async () => {
    expect((await call({ mode: "check" }, {})).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mauvais secret : 401, sans appel Discord", async () => {
    for (const value of ["autre", `${SECRET} `.toLowerCase(), SECRET.slice(0, -1), `${SECRET}x`]) {
      expect((await call({ mode: "check" }, { "x-registration-secret": value })).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CRON_SECRET n'ouvre pas la route", async () => {
    vi.stubEnv("CRON_SECRET", "secret-cron");
    expect((await call({ mode: "check" }, { authorization: "Bearer secret-cron" })).status).toBe(401);
    expect((await call({ mode: "check" }, { "x-registration-secret": "secret-cron" })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("secret correct mais pas administrateur authentifié : 401, même réponse que le secret faux", async () => {
    requireAdmin.mockResolvedValue(null);
    const withoutAdmin = await call();
    const wrongSecret = await call({ mode: "check" }, { "x-registration-secret": "faux" });
    expect(withoutAdmin.status).toBe(401);
    expect(await withoutAdmin.json()).toEqual(await wrongSecret.json());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mode manquant ou inconnu (dont « delete ») : 400, sans appel Discord", async () => {
    for (const body of [{}, { mode: "delete" }, { mode: "EXECUTE" }, { mode: 1 }, "pas du json", null]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/discord-commands : mode check", () => {
  it("un seul GET sur la route du serveur, aucune écriture, 13 commandes listées", async () => {
    const response = await call({ mode: "check" });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method ?? "GET").toBe("GET");
    const body = await response.json();
    expect(body.mode).toBe("check");
    expect(body.ok).toBe(true);
    expect(body.commands).toHaveLength(13);
    expect(body.commands.every((c: { status: string }) => c.status === "absente")).toBe(true);
    expect(body.commands.some((c: { name: string; kind: string }) => c.name === "Signaler" && c.kind === "message")).toBe(true);
  });

  it("classe présente / différente / absente et compte les commandes hors manifeste sans les toucher", async () => {
    const first = await call({ mode: "check" });
    const names = (await first.json()).commands.map((c: { name: string }) => c.name) as string[];
    expect(names.length).toBe(13);
    discordOk([{ name: "commande-etrangere", type: 1, description: "x" }, { name: "aide", type: 1, description: "pas la bonne description" }]);
    const body = await (await call({ mode: "check" })).json();
    expect(body.outsideManifest).toBe(1);
    expect(body.commands.find((c: { name: string }) => c.name === "aide").status).toBe("différente");
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== "POST")).toBe(true);
  });
});

describe("POST /api/admin/discord-commands : mode execute", () => {
  it("un GET puis un POST par commande, jamais de PUT, PATCH ni DELETE, jamais de route globale", async () => {
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(200);
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods.filter((m) => m === "GET")).toHaveLength(1);
    expect(methods.filter((m) => m === "POST")).toHaveLength(13);
    expect(methods.some((m) => ["PUT", "PATCH", "DELETE"].includes(m))).toBe(false);
    expect(fetchMock.mock.calls.every(([url]) => url === ENDPOINT)).toBe(true);
    const body = await response.json();
    expect(body.commands).toHaveLength(13);
    expect(body.commands.every((c: { status: string }) => c.status === "enregistrée")).toBe(true);
  });

  it("échec Discord 403 / 50001 à la lecture : 502, message actionnable, aucune écriture", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 50001 }), { status: 403 }));
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.failure).toMatchObject({ stage: "read", http: 403, code: "50001" });
    expect(body.failure.hint).toContain("scope applications.commands");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("échec du POST n : s'arrête, nomme la commande, n'envoie pas les suivantes", async () => {
    let posts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response("[]", { status: 200 });
      posts += 1;
      return posts === 3 ? new Response(JSON.stringify({ code: 50013 }), { status: 403 }) : new Response("{}", { status: 200 });
    });
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.commands).toHaveLength(2);
    expect(body.failure).toMatchObject({ stage: "write", code: "50013" });
    expect(typeof body.failure.command).toBe("string");
    expect(posts).toBe(3);
  });

  it("configuration Discord absente ou mauvais serveur : 503 sans appel Discord", async () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "999");
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(503);
    expect((await response.json()).failure).toEqual({ stage: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/discord-commands : aucune fuite de secret", () => {
  it("ni le jeton, ni le secret de route, ni l'identifiant d'application ne sortent, en succès comme en échec, ni dans les journaux", async () => {
    const outputs: string[] = [];
    outputs.push(await (await call({ mode: "check" })).text());
    outputs.push(await (await call({ mode: "execute" })).text());
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 50001, message: `${TOKEN} ${SECRET}` }), { status: 403 }));
    outputs.push(await (await call({ mode: "execute" })).text());
    fetchMock.mockRejectedValue(Object.assign(new Error(`panne ${TOKEN} ${SECRET}`), { name: "TypeError" }));
    outputs.push(await (await call({ mode: "check" })).text());
    outputs.push(JSON.stringify(logger.info.mock.calls));
    for (const text of outputs) {
      for (const secret of [TOKEN, SECRET, CLIENT_ID, "Bot "]) expect(text).not.toContain(secret);
    }
  });

  it("erreur réseau : nom de l'erreur seulement, 502", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error(`panne ${TOKEN}`), { name: "TimeoutError" }));
    const response = await call({ mode: "check" });
    expect(response.status).toBe(502);
    expect((await response.json()).failure).toEqual({ stage: "network", errorName: "TimeoutError" });
  });
});

describe("POST /api/admin/discord-commands : limite de débit", () => {
  it("au plus 5 appels par minute et par administrateur", async () => {
    requireAdmin.mockResolvedValue({ id: "meme-admin" });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await call({ mode: "check" })).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
