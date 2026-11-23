import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdmin() }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));
// Limiteur partagé : même comportement que la limite en mémoire, sans base (testé à part sur PostgreSQL).
vi.mock("@/lib/shared-rate-limit", async () => {
  const { checkRateLimit } = await import("@/lib/rate-limit");
  return { checkSharedRateLimit: async (...args: Parameters<typeof checkRateLimit>) => checkRateLimit(...args) };
});
const recordSensitiveOperation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sensitive-operation-log", () => ({ recordSensitiveOperation }));

import { POST } from "./route";

// Valeurs fictives : si l'une d'elles apparaît dans une réponse ou un journal, c'est une fuite.
const TOKEN = "TOKEN-FICTIF-NE-DOIT-JAMAIS-SORTIR";
const SECRET = "SECRET-FICTIF-DE-ROUTE";
const CLIENT_ID = "123456789012345678";
const GUILD_ID = "553922938101825536";
const ENDPOINT = `https://discord.com/api/v10/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;
const fetchMock = vi.fn();

/** Appelle la route en faisant avancer les minuteries simulées (pauses entre écritures Discord). */
async function call(body: unknown = { mode: "check" }, headers: Record<string, string> = { "x-registration-secret": SECRET }) {
  let done = false;
  const pending = invoke(body, headers).finally(() => {
    done = true;
  });
  while (!done) await vi.advanceTimersByTimeAsync(500);
  return pending;
}

function invoke(body: unknown, headers: Record<string, string>) {
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
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
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
  vi.useRealTimers();
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
    expect(body.commands).toHaveLength(13);
    expect(body.commands.slice(0, 2).every((c: { status: string }) => c.status === "enregistrée")).toBe(true);
    expect(body.commands[2].status).toBe("échec");
    expect(body.commands.slice(3).every((c: { status: string }) => c.status === "en attente")).toBe(true);
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

describe("POST /api/admin/discord-commands : limite de débit Discord", () => {
  it("429 avec Retry-After : attend puis réessaie la même commande, les 13 finissent enregistrées", async () => {
    let posts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response("[]", { status: 200 });
      posts += 1;
      return posts === 6 ? new Response(JSON.stringify({ retry_after: 2.5, global: false }), { status: 429, headers: { "retry-after": "3" } }) : new Response("{}", { status: 200 });
    });
    const started = Date.now();
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.commands).toHaveLength(13);
    expect(body.commands.every((c: { status: string }) => c.status === "enregistrée")).toBe(true);
    expect(posts).toBe(14);
    // 12 pauses d'au moins 1 s + l'attente Retry-After (2,5 s du corps)
    expect(Date.now() - started).toBeGreaterThanOrEqual(12_000 + 2_500 - 1_000);
  });

  it("seau épuisé (X-RateLimit-Remaining 0) : attend Reset-After avant l'écriture suivante", async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response("[]", { status: 200 });
      times.push(Date.now());
      return new Response("{}", { status: 200, headers: { "x-ratelimit-remaining": times.length === 1 ? "0" : "4", "x-ratelimit-reset-after": "7" } });
    });
    await call({ mode: "execute" });
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(7_000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1_000);
  });

  it("429 persistant : arrêt propre en 202, 13 lignes, aucune boucle sans fin, délai conseillé", async () => {
    let posts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response("[]", { status: 200 });
      posts += 1;
      return posts <= 5 ? new Response("{}", { status: 200 }) : new Response(JSON.stringify({ retry_after: 20 }), { status: 429 });
    });
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.commands).toHaveLength(13);
    expect(body.commands.filter((c: { status: string }) => c.status === "enregistrée")).toHaveLength(5);
    expect(body.commands.filter((c: { status: string }) => c.status === "en attente")).toHaveLength(8);
    expect(body.failure).toMatchObject({ stage: "rate_limit", retryAfterSeconds: 20 });
    expect(posts).toBeLessThanOrEqual(8);
  });

  it("reprise : les commandes déjà à jour sont sautées, seules les manquantes sont écrites", async () => {
    const first = await call({ mode: "check" });
    const names = (await first.json()).commands as { name: string }[];
    expect(names).toHaveLength(13);
    // Simule 5 commandes déjà enregistrées à l'identique : on relit le manifeste réel.
    const manifest = (await import("../../../../../scripts/discord-commands.json")).default as { name: string; type?: number }[];
    const installed = manifest.slice(0, 5).map((command) => ({ ...command, id: "1", application_id: "2", version: "3" }));
    const posted: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response(JSON.stringify(installed), { status: 200 });
      posted.push(JSON.parse(String(init.body)).name);
      return new Response("{}", { status: 200 });
    });
    const response = await call({ mode: "execute" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.commands).toHaveLength(13);
    expect(body.commands.filter((c: { status: string }) => c.status === "déjà à jour")).toHaveLength(5);
    expect(posted).toHaveLength(8);
    expect(posted).not.toContain(manifest[0].name);
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

describe("POST /api/admin/discord-commands : mode bulk (tout enregistrer d’un coup)", () => {
  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as RequestInit | undefined)?.method ?? "GET", body: (init as RequestInit | undefined)?.body }));

  it("un GET puis UN SEUL PUT sur le serveur The Tower avec le manifeste complet : jamais de POST, DELETE, ni d’URL globale", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("[]", { status: 200 }) : new Response("[]", { status: 200 })
    );
    const response = await call({ mode: "bulk" });
    expect(response.status).toBe(200);
    const all = calls();
    expect(all.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(all.every((c) => c.url === ENDPOINT)).toBe(true);
    expect(all.some((c) => c.url.includes("/applications/") && !c.url.includes("/guilds/"))).toBe(false);
    const sent = JSON.parse(String(all[1].body)) as { name: string }[];
    expect(sent).toHaveLength(13);
    const body = await response.json();
    expect(body.commands).toHaveLength(13);
    expect(body.commands.every((c: { status: string }) => c.status === "enregistrée")).toBe(true);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(recordSensitiveOperation).toHaveBeenCalledWith(expect.objectContaining({ action: "discord.commands_bulk", outcome: "ok" }));
  });

  it("refus si le serveur porte une commande hors manifeste : 409, aucune écriture (un PUT la supprimerait)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: "1", name: "commande-etrangere", type: 1, description: "x" }]), { status: 200 }));
    const response = await call({ mode: "bulk" });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.failure.stage).toBe("outside_manifest");
    expect(body.outsideManifest).toBe(1);
    expect(calls().map((c) => c.method)).toEqual(["GET"]);
  });

  it("limite de débit Discord sur le PUT : 202 avec le délai, aucune boucle sans fin", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response(JSON.stringify({ retry_after: 90 }), { status: 429 }) : new Response("[]", { status: 200 })
    );
    const response = await call({ mode: "bulk" });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.failure).toMatchObject({ stage: "rate_limit", http: 429 });
    expect(calls().filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("refus Discord du PUT (403 / 50013) : 502, toutes les lignes en échec", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response(JSON.stringify({ code: 50013 }), { status: 403 }) : new Response("[]", { status: 200 })
    );
    const response = await call({ mode: "bulk" });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.failure).toMatchObject({ stage: "write", http: 403, code: "50013" });
    expect(body.commands.every((c: { status: string }) => c.status === "échec")).toBe(true);
  });

  it("tout est déjà à jour : aucune écriture", async () => {
    const { default: manifest } = await import("../../../../../scripts/discord-commands.json");
    const installed = (manifest as { name: string; type?: number; description?: string; options?: object[]; default_member_permissions?: string | null }[]).map((c, i) => ({ id: String(i), ...c }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify(installed), { status: 200 }));
    const response = await call({ mode: "bulk" });
    expect(response.status).toBe(200);
    expect(calls().map((c) => c.method)).toEqual(["GET"]);
    const body = await response.json();
    expect(body.commands.every((c: { status: string }) => c.status === "déjà à jour")).toBe(true);
  });

  it("garde les mêmes verrous que les autres modes (secret faux = 401, aucun appel Discord)", async () => {
    const response = await call({ mode: "bulk" }, { "x-registration-secret": "mauvais" });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
