import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Garde de non-régression `/role` : la commande doit rester déclarée dans le
 * fichier réellement envoyé à Discord, branchée sur l'endpoint d'interactions,
 * et ses trois interrupteurs doivent rester documentés. Le comportement
 * lui-même est testé dans `discord-role-command.test.ts`.
 */
const root = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const commands = JSON.parse(read("scripts/discord-commands.json")) as Array<{
  name: string;
  options?: Array<{ type: number; name: string; options?: Array<{ name: string; required?: boolean }> }>;
}>;

describe("déclaration Discord de /role", () => {
  it("expose chercher, attribuer, creer et retirer avec l'option jeu obligatoire", () => {
    const role = commands.find((command) => command.name === "role");
    expect(role, "/role déclarée").toBeDefined();
    expect(role!.options?.map((option) => option.name)).toEqual(["chercher", "attribuer", "creer", "retirer"]);
    for (const sub of role!.options ?? []) {
      expect(sub.type).toBe(1);
      expect(sub.options?.map((option) => option.name)).toEqual(["jeu"]);
      expect(sub.options?.[0]?.required).toBe(true);
    }
  });

  it("conserve les commandes non gérées par GameNight", () => {
    const require = createRequire(import.meta.url);
    const merge = require("../../scripts/discord-command-merge.cjs") as (
      existing: unknown[],
      requested: unknown[]
    ) => Array<{ name: string }>;
    const merged = merge([{ name: "gamenight", type: 1 }, { name: "role", type: 1, description: "ancienne" }], commands);
    expect(merged.map((command) => command.name)).toEqual(
      expect.arrayContaining(["gamenight", "role", "tower", "tower-admin"]),
    );
    expect(merged.filter((command) => command.name === "role")).toHaveLength(1);
  });
});

describe("branchement de /role", () => {
  it("reste branchée sur l'endpoint d'interactions signé", () => {
    const interactions = read("src/lib/discord-interactions.ts");
    expect(interactions).toContain('interaction.data?.name === "role"');
    expect(interactions).toContain("handleSignedRoleInteraction");
    expect(interactions).toContain("runRole?: () => Promise<void>");
    expect(read("src/app/api/discord/interactions/route.ts")).toContain("if (runRole) after(runRole);");
  });

  it("documente les interrupteurs et le plafond de création", () => {
    const env = read(".env.example");
    for (const flag of ["DISCORD_ROLE_COMMAND_ENABLED", "DISCORD_ROLE_SELF_CREATION_ENABLED", "DISCORD_ROLE_MAX_GUILD_ROLES"]) {
      expect(env, flag).toContain(flag);
    }
  });
});
