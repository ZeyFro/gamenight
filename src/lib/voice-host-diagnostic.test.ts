import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const url = pathToFileURL(resolve("scripts/voice-host-diagnostic.mjs")).href;
const mod = (await import(/* @vite-ignore */ url)) as {
  evaluate: (facts: unknown) => { id: string; status: string; detail: string }[];
  exitCodeFor: (checks: { status: string }[]) => number;
  parseArgs: (argv: string[]) => { error?: string; opts?: Record<string, unknown> };
  parseEnvNames: (content: string) => { counts: Map<string, number>; flagIsFalse: boolean };
  REQUIRED_NAMES: string[];
  ACTIVATION_NAMES: string[];
};

const names = (list: string[], flagFalse = true) => ({ names: new Map(list.map(n => [n, 1])), flagIsFalse: flagFalse });
const facts = (over: Record<string, unknown> = {}) => ({
  nodeVersion: "v22.16.0", dockerVersion: "Docker version 27", arch: "arm64", freeMemBytes: 512 * 1048576, totalMemBytes: 1024 * 1048576,
  diskFreeBytes: 4096 * 1048576, clockSynced: true, unitPresent: true, unitPath: "/etc/systemd/system/gamenight.service",
  image: "gamenight-voice-worker:local", imagePresent: true, envPath: "/etc/gamenight/gamenight.env",
  env: { exists: true, mode: 0o600, uid: 0, gid: 0, ...names([...mod.REQUIRED_NAMES, ...mod.ACTIVATION_NAMES]) },
  dns: { "gateway.discord.gg": { ok: true, addresses: 2 }, "discord.com": { ok: true, addresses: 2 } },
  ...over,
});
const status = (checks: { id: string; status: string }[], id: string) => checks.find(c => c.id === id)?.status;

describe("diagnostic d'hôte du worker vocal (décisions pures, aucune E/S)", () => {
  it("un hôte conforme n'a aucun échec", () => {
    expect(mod.exitCodeFor(mod.evaluate(facts()))).toBe(0);
  });

  it("refuse les permissions d'environnement autres que 0600 root:root", () => {
    expect(status(mod.evaluate(facts({ env: { exists: true, mode: 0o644, uid: 0, gid: 0, ...names(mod.REQUIRED_NAMES) } })), "env-permissions")).toBe("fail");
    expect(status(mod.evaluate(facts({ env: { exists: true, mode: 0o600, uid: 1000, gid: 1000, ...names(mod.REQUIRED_NAMES) } })), "env-permissions")).toBe("fail");
  });

  it("signale les noms absents et le drapeau non éteint ou dupliqué, sans jamais exposer de valeur", () => {
    const checks = mod.evaluate(facts({ env: { exists: true, mode: 0o600, uid: 0, gid: 0, names: new Map([["VOICE_PRESENCE_ENABLED", 2]]), flagIsFalse: true } }));
    expect(status(checks, "var:DATABASE_URL")).toBe("fail");
    expect(status(checks, "var:DISCORD_BOT_TOKEN")).toBe("info");
    expect(status(checks, "collecte-eteinte")).toBe("fail");
    expect(status(mod.evaluate(facts({ env: { exists: true, mode: 0o600, uid: 0, gid: 0, ...names(mod.REQUIRED_NAMES, false) } })), "collecte-eteinte")).toBe("fail");
    expect(JSON.stringify(checks)).not.toMatch(/=/);
  });

  it("échoue sur Node trop ancien, horloge désynchronisée, disque saturé, DNS ou fichier d'environnement absents", () => {
    expect(status(mod.evaluate(facts({ nodeVersion: "v20.11.0" })), "node")).toBe("fail");
    expect(status(mod.evaluate(facts({ nodeVersion: "v22.15.0" })), "node")).toBe("ok");
    expect(status(mod.evaluate(facts({ clockSynced: false })), "horloge")).toBe("fail");
    expect(status(mod.evaluate(facts({ clockSynced: null })), "horloge")).toBe("warn");
    expect(status(mod.evaluate(facts({ diskFreeBytes: 100 * 1048576 })), "disque")).toBe("fail");
    expect(status(mod.evaluate(facts({ dns: { "gateway.discord.gg": { ok: false }, "discord.com": { ok: true, addresses: 1 } } })), "dns:gateway.discord.gg")).toBe("fail");
    expect(status(mod.evaluate(facts({ env: { exists: false } })), "env-fichier")).toBe("fail");
  });

  it("parseEnvNames ne retient que les noms et un booléen pour le drapeau", () => {
    const parsed = mod.parseEnvNames("# commentaire\nDATABASE_URL=postgresql://u:p@h/db\nexport DISCORD_BOT_TOKEN=abc\nVOICE_PRESENCE_ENABLED=false\nignore me\n");
    expect([...parsed.counts.keys()].sort()).toEqual(["DATABASE_URL", "DISCORD_BOT_TOKEN", "VOICE_PRESENCE_ENABLED"]);
    expect(parsed.flagIsFalse).toBe(true);
    expect(JSON.stringify([...parsed.counts])).not.toMatch(/postgresql|abc/);
  });

  it("refuse toute option d'écriture ou inconnue (usage = code 2) et accepte les options en lecture", () => {
    for (const bad of [["--write"], ["--fix"], ["--output", "x"], ["-o", "x"], ["--env-file"], ["positionnel"]]) {
      expect(mod.parseArgs(bad).error).toBeTruthy();
    }
    expect(mod.parseArgs(["--env-file", "/tmp/x", "--json"]).opts).toMatchObject({ envFile: "/tmp/x", json: true });
    const r = spawnSync(process.execPath, ["scripts/voice-host-diagnostic.mjs", "--write"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("lecture seule");
  });
});
