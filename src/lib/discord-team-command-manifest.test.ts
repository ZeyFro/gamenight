import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
