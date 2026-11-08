import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import commands from "../../scripts/discord-commands.json";

describe("définition installable de /equipe", () => {
  it("propose les trois actions du handler, en serveur et pour tous les membres", () => {
    const command = commands.find(command => command.name === "equipe");
    expect(command).toMatchObject({
      name: "equipe", type: 1, default_member_permissions: null,
      integration_types: [0], contexts: [0],
      options: [
        { type: 1, name: "liste" },
        { type: 1, name: "moi" },
        { type: 1, name: "rejoindre", options: [
          { type: 3, name: "equipe_id", required: true, min_length: 1, max_length: 191 },
        ] },
      ],
    });
    expect(command?.options).toHaveLength(3);
  });

  it("inclut /equipe dans la simulation du script existant sans identifiants", () => {
    const env = { ...process.env };
    delete env.DISCORD_CLIENT_ID;
    delete env.DISCORD_BOT_TOKEN;
    const result = spawnSync(process.execPath, [
      "--import", "data:text/javascript,globalThis.fetch = () => { throw new Error('Réseau interdit en simulation'); };",
      fileURLToPath(new URL("../../scripts/register-discord-commands.mjs", import.meta.url)),
    ], {
      env, encoding: "utf8", timeout: 5_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const manifest = JSON.parse(result.stdout.slice(result.stdout.indexOf("["))) as Array<{name: string}>;
    expect(manifest).toEqual(commands);
    expect(manifest.map(command => command.name)).toContain("equipe");
    expect(manifest.map(command => command.name)).toEqual(expect.arrayContaining(["gamenight", "tower", "tower-admin"]));
  });
});

describe("plan hors ligne de /equipe en serveur", () => {
  const applicationId = "123456789012345678";
  const guildId = "234567890123456789";
  const existing = {
    id: "345678901234567890", application_id: applicationId, guild_id: guildId,
    type: 1, name: "staff", description: "Commande réservée", default_member_permissions: "32", nsfw: true,
  };
  const snapshot = (overrides = {}) => ({ application_id: applicationId, guild_id: guildId, commands: [existing], ...overrides });
  function plan(value: unknown, extra: string[] = [], ids = [applicationId, guildId]) {
    const directory = mkdtempSync(join(tmpdir(), "gamenight-team-plan-"));
    try {
      const path = join(directory, "snapshot.json");
      writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
      return spawnSync(process.execPath, [
        "--import", "data:text/javascript,globalThis.fetch = () => { throw new Error('Réseau interdit'); };",
        fileURLToPath(new URL("../../scripts/plan-team-guild-commands.mjs", import.meta.url)),
        "--application-id", ids[0], "--guild-id", ids[1], "--snapshot", path, ...extra,
      ], { encoding: "utf8", timeout: 5_000, env: { NODE_ENV: "test" } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("produit un plan déterministe POST guild sans réseau et conserve les commandes tierces", () => {
    const first = plan(snapshot());
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe(plan(snapshot()).stdout);
    const result = JSON.parse(first.stdout);
    expect(result).toMatchObject({ offline: true, method: "POST", route: `/applications/${applicationId}/guilds/${guildId}/commands` });
    expect(result.plannedCommands).toEqual([existing, result.payload]);
    expect(result.payload).toMatchObject({ name: "equipe", default_member_permissions: null });
    expect(result.payload).not.toHaveProperty("contexts");
    expect(result.payload).not.toHaveProperty("integration_types");
    expect(result.payload).not.toHaveProperty("guild_id");
    expect(result.payload).not.toHaveProperty("application_id");
  });

  it("conserve les restrictions d'une /equipe existante sans les élargir", () => {
    const current = { ...existing, name: "equipe", default_member_permissions: "0", default_permission: false };
    const result = plan(snapshot({ commands: [existing, current] }));
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.payload).toMatchObject({ default_member_permissions: "0", default_permission: false, nsfw: true });
    expect(output.plannedCommands).toEqual([existing, output.payload]);
  });

  it.each([
    ["mauvaise application", snapshot({ application_id: guildId })],
    ["mauvais serveur", snapshot({ guild_id: applicationId })],
    ["commande globale", snapshot({ commands: [{ ...existing, guild_id: undefined }] })],
    ["commande d'une autre application", snapshot({ commands: [{ ...existing, application_id: guildId }] })],
    ["commande d'un autre serveur", snapshot({ commands: [{ ...existing, guild_id: applicationId }] })],
    ["doublon", snapshot({ commands: [existing, existing] })],
    ["JSON invalide", "{"],
    ["nouveau champ de permission inconnu", snapshot({ commands: [{ ...existing, future_permissions: "8" }] })],
    ["permission cible inconnue", snapshot({ commands: [{ ...existing, name: "equipe", default_member_permissions: undefined }] })],
    ["permission numérique ambiguë", snapshot({ commands: [{ ...existing, name: "equipe", default_member_permissions: 32 }] })],
    ["permission mal formée", snapshot({ commands: [{ ...existing, name: "equipe", default_member_permissions: "admin" }] })],
    ["restriction booléenne mal formée", snapshot({ commands: [{ ...existing, nsfw: "false" }] })],
    ["secret dans l'enveloppe", snapshot({ token: "faux-token-interdit" })],
  ])("refuse un snapshot incohérent : %s", (_label, value) => {
    const result = plan(value);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });

  it.each(["--execute", "--check", "--token", "--unknown", "--guild-id", "--application-id"])("refuse toute option inconnue ou répétée : %s", option => {
    const result = plan(snapshot(), [option]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("refuse des identifiants invalides et accepte un snapshot vide explicitement scopé", () => {
    expect(plan(snapshot(), [], ["../global", guildId]).status).toBe(1);
    const result = plan(snapshot({ commands: [] }));
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).plannedCommands).toHaveLength(1);
  });
});
