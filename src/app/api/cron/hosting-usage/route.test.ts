import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ size: vi.fn() }));
vi.mock("@/lib/hosting-usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hosting-usage")>("@/lib/hosting-usage");
  return { ...actual, readDatabaseSizeBytes: reads.size };
});
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));

import { GET } from "./route";

const SECRET = "SECRET-CRON-FICTIF";
const call = (header: string | null = `Bearer ${SECRET}`) =>
  GET(new Request("https://example.test/api/cron/hosting-usage", { headers: header ? { authorization: header } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("HOSTING_ALERT_ENABLED", "true");
  reads.size.mockResolvedValue(22 * 1024 ** 2);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/hosting-usage", () => {
  it("fail-closed : 503 sans CRON_SECRET, 401 avec un mauvais secret ou sans en-tête, aucune lecture", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call()).status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call("Bearer autre")).status).toBe(401);
    expect((await call(null)).status).toBe(401);
    expect(reads.size).not.toHaveBeenCalled();
  });
  it("éteint : {enabled:false} en 200, aucune lecture", async () => {
    vi.stubEnv("HOSTING_ALERT_ENABLED", "false");
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(reads.size).not.toHaveBeenCalled();
  });
  it("sous les seuils : 200 « ok », avec le rappel du temps de calcul à relever à la main", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", level: "ok", readErrors: [] });
    expect(body.manual).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
  it("à 70 % : 503 « alert » (le moniteur externe prévient par e-mail) ; à 90 % : critique", async () => {
    reads.size.mockResolvedValue(0.75 * 1024 ** 3);
    const warn = await call();
    expect(warn.status).toBe(503);
    expect(await warn.json()).toMatchObject({ status: "alert", level: "warn" });
    reads.size.mockResolvedValue(0.95 * 1024 ** 3);
    const critical = await call();
    expect(critical.status).toBe(503);
    expect((await critical.json()).level).toBe("critical");
    expect(logger.error).toHaveBeenCalled();
  });
  it("une lecture qui échoue est journalisée et signalée, sans compter comme alerte", async () => {
    reads.size.mockRejectedValue(new Error("base indisponible"));
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readErrors).toEqual(["storage"]);
    expect(body.level).toBe("unknown");
    expect(logger.error).toHaveBeenCalled();
  });
  it("la réponse ne contient jamais le secret ni une variable d'environnement", async () => {
    const text = await (await call()).text();
    expect(text).not.toContain(SECRET);
  });
});
