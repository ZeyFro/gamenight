import { describe, expect, it, vi } from "vitest";
import { EXPECTED_GUILD_ID, explainFailure, loadTowerCommands, run } from "../../scripts/register-tower-guild-commands.mjs";

const SECRET = "jeton-secret-ne-doit-jamais-sortir";
const env = { DISCORD_CLIENT_ID: "123456789", TOWER_DISCORD_GUILD_ID: EXPECTED_GUILD_ID, DISCORD_BOT_TOKEN: SECRET };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const collect = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m: string) => out.push(m), fail: (m: string) => err.push(m) };
};

describe("register-tower-guild-commands", () => {
  it("charge uniquement tower et tower-admin", () => {
    expect(loadTowerCommands().map((c: { name: string }) => c.name).sort()).toEqual(["tower", "tower-admin"]);
  });

  it("dry-run par défaut : aucun appel réseau, même sans variables", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    expect(await run({ argv: [], env: {}, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(c.out[0]).toContain("Simulation");
  });

  it("refuse --check avec --execute", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    expect(await run({ argv: ["--check", "--execute"], env, fetchImpl, ...c })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuse une configuration invalide sans appeler Discord", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    const bad = { ...env, TOWER_DISCORD_GUILD_ID: "999" };
    expect(await run({ argv: ["--check"], env: bad, fetchImpl, ...c })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("--check : un seul GET, aucune écriture", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, [{ name: "tower" }]));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(fetchImpl.mock.calls[0][0]).toContain(`/guilds/${EXPECTED_GUILD_ID}/commands`);
    expect(c.out).toEqual(["/tower : présente", "/tower-admin : absente"]);
  });

  it("--execute : GET puis deux POST sur l'URL du serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [])).mockResolvedValue(json(201, {}));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl.mock.calls.map((x) => x[1].method ?? "GET")).toEqual(["GET", "POST", "POST"]);
    expect(fetchImpl.mock.calls.every((x) => String(x[0]).includes("/guilds/"))).toBe(true);
  });

  it("403 code 50001 : message dédié, code affiché, jamais de secret, aucune écriture", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(403, { code: 50001, message: "Missing Access" }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, ...c })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const all = [...c.out, ...c.err].join("\n");
    expect(all).toContain("HTTP 403, code 50001");
    expect(all).toContain("applications.commands");
    expect(all).not.toContain(SECRET);
  });

  it("401 : message jeton", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { code: 0 }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
    expect(c.err.join("\n")).toContain("Jeton refusé (401)");
  });

  it("403 sans corps exploitable : code indisponible", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>", { status: 403 }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
    expect(c.err.join("\n")).toContain("code indisponible");
  });

  it("échec d'un POST : s'arrête et nomme la commande", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [])).mockResolvedValueOnce(json(403, { code: 50001 }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, ...c })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(c.err.join("\n")).toContain("/tower");
  });

  it("erreur réseau : nom d'erreur seulement, pas de secret", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error(`boom ${SECRET}`), { name: "TypeError" }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
    expect(c.err.join("\n")).not.toContain(SECRET);
  });

  it("explainFailure couvre 404 et 429, vide sinon", () => {
    expect(explainFailure(404, "10004")).toContain("404");
    expect(explainFailure(429, "0")).toContain("429");
    expect(explainFailure(500, "0")).toBe("");
  });
});
