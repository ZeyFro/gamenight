import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_GUILD_ID,
  classify,
  explainFailure,
  loadManifestCommands,
  run,
  validateCommand,
  validateManifest,
} from "../../scripts/register-tower-guild-commands.mjs";

const SECRET = "jeton-secret-ne-doit-jamais-sortir";
const env = { DISCORD_CLIENT_ID: "123456789", TOWER_DISCORD_GUILD_ID: EXPECTED_GUILD_ID, DISCORD_BOT_TOKEN: SECRET };
const noSleep = async () => {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const collect = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m: string) => out.push(m), fail: (m: string) => err.push(m) };
};

type Command = { name: string; [key: string]: unknown };
const manifest: Command[] = JSON.parse(readFileSync(new URL("../../scripts/discord-commands.json", import.meta.url), "utf8"));
const manifestNames = manifest.map((c) => c.name);
const loaded = loadManifestCommands() as Command[];

/** Réponse Discord réaliste : champs ajoutés (id, version, localisations) et options sans `required: false`. */
const asInstalled = (command: Command): Command => ({
  ...command,
  id: "111111111111111111",
  application_id: "123456789",
  guild_id: EXPECTED_GUILD_ID,
  version: "222222222222222222",
  name_localizations: null,
  description_localizations: null,
});

describe("register-tower-guild-commands : manifeste", () => {
  it("charge toutes les commandes du manifeste, dans l'ordre, sans doublon", () => {
    expect(loaded.map((c) => c.name)).toEqual(manifestNames);
    expect(new Set(manifestNames).size).toBe(manifestNames.length);
    expect(manifestNames).toEqual(
      expect.arrayContaining(["gamenight", "tower", "tower-admin", "equipe", "role", "aide", "profil", "boost", "joueurs", "soiree", "tournoi"]),
    );
  });

  it("retire integration_types et contexts du corps envoyé", () => {
    for (const command of loaded) {
      expect(command).not.toHaveProperty("integration_types");
      expect(command).not.toHaveProperty("contexts");
    }
  });

  it("/gamenight setup est incluse telle que déclarée (permission 32, sous-commande setup)", () => {
    const gamenight = loaded.find((c) => c.name === "gamenight") as Command & { options: Array<{ name: string }> };
    expect(gamenight.default_member_permissions).toBe("32");
    expect(gamenight.options.map((o) => o.name)).toEqual(["setup"]);
  });

  it("le manifeste réel est valide", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("rejette nom, description, permission et options invalides avant tout appel", () => {
    const base = { name: "ok", type: 1, description: "Une commande" };
    expect(validateCommand(base)).toEqual([]);
    expect(validateCommand({ ...base, name: "Majuscule" })).not.toEqual([]);
    expect(validateCommand({ ...base, name: "" })).not.toEqual([]);
    expect(validateCommand({ ...base, description: "" })).not.toEqual([]);
    expect(validateCommand({ ...base, description: "x".repeat(101) })).not.toEqual([]);
    expect(validateCommand({ ...base, type: 2 })).not.toEqual([]);
    expect(validateCommand({ ...base, default_member_permissions: 32 })).not.toEqual([]);
    expect(validateCommand({ ...base, default_member_permissions: "abc" })).not.toEqual([]);
    expect(validateCommand({ ...base, default_member_permissions: null })).toEqual([]);
    expect(validateCommand({ ...base, options: "non" })).not.toEqual([]);
    expect(validateCommand({ ...base, options: [{ type: 99, name: "a", description: "b" }] })).not.toEqual([]);
    expect(
      validateCommand({ ...base, options: [{ type: 3, name: "a", description: "b" }, { type: 3, name: "a", description: "b" }] }),
    ).not.toEqual([]);
    expect(
      validateCommand({ ...base, options: [{ type: 3, name: "a", description: "b" }, { type: 3, name: "c", description: "d", required: true }] }),
    ).not.toEqual([]);
  });

  it("rejette un doublon de nom", () => {
    const a = { name: "a", type: 1, description: "A" };
    expect(validateManifest([a, a]).join("\n")).toContain("deux fois");
    expect(validateManifest([])).not.toEqual([]);
  });

  it("run refuse un manifeste invalide sans appel réseau, même avec --execute", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    const commands = [{ name: "Mauvais", type: 1, description: "x" }];
    expect(await run({ argv: ["--execute"], env, fetchImpl, commands, sleep: noSleep, ...c })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(c.err.join("\n")).toContain("Manifeste invalide");
  });
});

describe("register-tower-guild-commands : simulation", () => {
  it("par défaut : aucun appel réseau, même sans variables, plan de toutes les commandes", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    expect(await run({ argv: [], env: {}, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const all = c.out.join("\n");
    expect(all).toContain("Simulation");
    for (const command of manifest) expect(all).toContain(command.type === 3 ? `POST (upsert) « ${command.name} » (commande de message` : `POST (upsert) /${command.name}`);
    expect(all).toContain("permission 32");
    expect(all).toContain("/gamenight setup");
    expect(all).toContain("Aucun PUT global");
  });

  it("n'affiche aucun secret même si l'environnement en contient", async () => {
    const c = collect();
    await run({ argv: [], env, fetchImpl: vi.fn(), ...c });
    expect([...c.out, ...c.err].join("\n")).not.toContain(SECRET);
  });
});

describe("register-tower-guild-commands : modes exclusifs", () => {
  it("refuse --check avec --execute", async () => {
    const fetchImpl = vi.fn();
    const c = collect();
    expect(await run({ argv: ["--check", "--execute"], env, fetchImpl, ...c })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(c.err.join("\n")).toContain("soit --check, soit --execute");
  });

  it("refuse un argument inconnu (dont --delete et --force)", async () => {
    for (const arg of ["--delete", "--force", "--put"]) {
      const fetchImpl = vi.fn();
      const c = collect();
      expect(await run({ argv: [arg], env, fetchImpl, ...c })).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("refuse une configuration invalide sans appeler Discord", async () => {
    for (const mode of ["--check", "--execute"]) {
      for (const bad of [{ ...env, TOWER_DISCORD_GUILD_ID: "999" }, { ...env, DISCORD_BOT_TOKEN: "" }, { ...env, DISCORD_CLIENT_ID: "abc" }]) {
        const fetchImpl = vi.fn();
        const c = collect();
        expect(await run({ argv: [mode], env: bad, fetchImpl, ...c })).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect([...c.out, ...c.err].join("\n")).not.toContain(SECRET);
      }
    }
  });
});

describe("register-tower-guild-commands : --check", () => {
  it("un seul GET sur la route du serveur, aucune écriture", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, []));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://discord.com/api/v10/applications/123456789/guilds/${EXPECTED_GUILD_ID}/commands`);
    expect(c.out.filter((l) => l.endsWith(": absente"))).toHaveLength(manifest.length);
  });

  it("présente / absente / différente, et compte les commandes hors manifeste sans les toucher", async () => {
    const tower = asInstalled(manifest.find((c) => c.name === "tower")!);
    const role = asInstalled(manifest.find((c) => c.name === "role")!);
    role.description = "Ancienne description";
    const foreign = { name: "autre-bot", type: 1, description: "x", id: "1" };
    const fetchImpl = vi.fn().mockResolvedValue(json(200, [tower, role, foreign]));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.out).toContain("/tower : présente");
    expect(c.out).toContain("/role : différente");
    expect(c.out).toContain("/gamenight : absente");
    expect(c.out.at(-1)).toBe("1 commande(s) du serveur hors manifeste : non touchées.");
    expect(c.out.filter((l) => /^\/[A-Za-z-]+ : /.test(l))).toHaveLength(manifest.length);
  });

  it("toutes présentes quand Discord renvoie les commandes avec ses champs ajoutés", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, manifest.map(asInstalled)));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(0);
    expect(c.out.filter((l) => l.endsWith(": présente"))).toHaveLength(manifest.length);
  });

  it("classify détecte permission, option ajoutée et contrainte modifiées", () => {
    const tower = manifest.find((c) => c.name === "tower-admin")!;
    expect(classify(tower, [asInstalled(tower)])).toBe("présente");
    expect(classify(tower, [{ ...asInstalled(tower), default_member_permissions: null }])).toBe("différente");
    expect(classify(tower, [{ ...asInstalled(tower), options: [] }])).toBe("différente");
    const changed = structuredClone(asInstalled(tower)) as unknown as { options: Array<{ options?: Array<{ max_length?: number }> }> };
    changed.options[0].options![0].max_length = 5;
    expect(classify(tower, [changed])).toBe("différente");
    expect(classify(tower, [])).toBe("absente");
  });
});

describe("register-tower-guild-commands : --execute", () => {
  it("GET puis un POST par commande du manifeste, dans l'ordre, sur la route du serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [])).mockResolvedValue(json(201, {}));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...c })).toBe(0);
    const calls = fetchImpl.mock.calls;
    expect(calls.map((x) => x[1].method ?? "GET")).toEqual(["GET", ...manifest.map(() => "POST")]);
    expect(calls).toHaveLength(manifest.length + 1);
    expect(calls.every((x) => String(x[0]).includes(`/guilds/${EXPECTED_GUILD_ID}/commands`))).toBe(true);
    expect(calls.slice(1).map((x) => JSON.parse(x[1].body).name)).toEqual(manifestNames);
    expect(c.out).toEqual(manifestNames.map((n) => `/${n} : enregistrée sur The Tower.`));
  });

  it("aucun PUT, aucun DELETE, aucun PATCH ; corps = manifeste sans integration_types/contexts", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [{ name: "autre-bot", type: 1 }])).mockResolvedValue(json(200, {}));
    await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...collect() });
    const methods = fetchImpl.mock.calls.map((x) => x[1].method ?? "GET");
    expect(methods.filter((m) => !["GET", "POST"].includes(m))).toEqual([]);
    expect(fetchImpl.mock.calls.slice(1).map((x) => JSON.parse(x[1].body))).toEqual(loaded);
    expect(fetchImpl.mock.calls.every((x) => !String(x[0]).endsWith("/autre-bot"))).toBe(true);
  });

  it("envoie le jeton uniquement dans l'en-tête Authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [])).mockResolvedValue(json(201, {}));
    await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...collect() });
    for (const call of fetchImpl.mock.calls) {
      expect(call[1].headers.Authorization).toBe(`Bot ${SECRET}`);
      expect(String(call[0])).not.toContain(SECRET);
      expect(String(call[1].body ?? "")).not.toContain(SECRET);
    }
  });

  it("403 code 50001 à la lecture : message dédié, code affiché, aucun POST, aucun secret", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(403, { code: 50001, message: "Missing Access" }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...c })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const all = [...c.out, ...c.err].join("\n");
    expect(all).toContain("HTTP 403, code 50001");
    expect(all).toContain("applications.commands");
    expect(all).toContain("Aucune écriture");
    expect(all).not.toContain(SECRET);
  });

  it("échec du POST n (403) : s'arrête, nomme la commande, n'envoie pas les suivantes, une ligne par commande", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(201, {}))
      .mockResolvedValueOnce(json(403, { code: 50013 }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...c })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(c.out).toHaveLength(manifestNames.length);
    expect(c.out[0]).toBe(`/${manifestNames[0]} : enregistrée sur The Tower.`);
    expect(c.out[1]).toBe(`/${manifestNames[1]} : échec`);
    expect(c.out.slice(2).every((line) => line.endsWith(": en attente"))).toBe(true);
    expect(c.err.join("\n")).toContain(`/${manifestNames[1]}`);
    expect(c.err.join("\n")).toContain("50013");
  });

  it("429 répété : s'arrête sans boucler, conseille d'attendre puis de relancer", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, [])).mockResolvedValue(json(429, { code: 0, retry_after: 3 }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...c })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(c.err.join("\n")).toContain("relancer dans 3 s");
    expect(c.out.every((line) => line.endsWith(": en attente"))).toBe(true);
  });

  it("erreur réseau : nom d'erreur seulement, pas de secret", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error(`boom ${SECRET}`), { name: "TypeError" }));
    const c = collect();
    expect(await run({ argv: ["--execute"], env, fetchImpl, sleep: noSleep, ...c })).toBe(1);
    expect([...c.out, ...c.err].join("\n")).not.toContain(SECRET);
  });
});

describe("register-tower-guild-commands : erreurs Discord", () => {
  it.each([
    [401, "0", "Jeton refusé (401)"],
    [403, "50001", "applications.commands"],
    [403, "20", "Accès refusé (403)"],
    [404, "10004", "404"],
    [429, "0", "429"],
  ])("--check : HTTP %s code %s -> message dédié", async (status, code, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(json(status as number, { code: Number(code) }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
    expect(c.err.join("\n")).toContain(expected);
    expect(c.err.join("\n")).not.toContain(SECRET);
  });

  it("403 sans corps exploitable : code indisponible", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>", { status: 403 }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
    expect(c.err.join("\n")).toContain("code indisponible");
  });

  it("réponse de lecture qui n'est pas un tableau : échec propre", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { message: "x" }));
    const c = collect();
    expect(await run({ argv: ["--check"], env, fetchImpl, ...c })).toBe(1);
  });

  it("explainFailure couvre 50013, 404 et 429, vide sinon", () => {
    expect(explainFailure(403, "50013")).toContain("50013");
    expect(explainFailure(404, "10004")).toContain("404");
    expect(explainFailure(429, "0")).toContain("429");
    expect(explainFailure(500, "0")).toBe("");
  });
});
