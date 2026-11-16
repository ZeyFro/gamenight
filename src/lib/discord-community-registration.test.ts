import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde de non-régression `/aide` et `/profil` : déclaration réellement
 * envoyée à Discord, branchement sur l'endpoint signé, exécution différée par
 * `after()`, et documentation de l'interrupteur. Le comportement est couvert
 * par `discord-community-commands.test.ts`.
 */
const root = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const commands = JSON.parse(read("scripts/discord-commands.json")) as Array<{ name: string; options?: unknown[] }>;

describe("déclaration Discord de /aide et /profil", () => {
  it("expose les deux commandes sans option", () => {
    const help = commands.find((command) => command.name === "aide");
    const profile = commands.find((command) => command.name === "profil");
    expect(help, "/aide déclarée").toBeDefined();
    expect(profile, "/profil déclarée").toBeDefined();
    expect(help!.options).toBeUndefined();
    expect(profile!.options).toBeUndefined();
  });

  it("ne réintroduit pas de commande en double", () => {
    const names = commands.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("branchement de /aide et /profil", () => {
  const interactions = read("src/lib/discord-interactions.ts");

  it("route les deux noms vers le handler signé", () => {
    expect(interactions).toContain('interaction.data?.name === "aide"');
    expect(interactions).toContain('interaction.data?.name === "profil"');
    expect(interactions).toContain("handleSignedCommunityInteraction");
    expect(interactions).toContain("runCommunity?: () => Promise<void>");
  });

  it("exécute la réponse après l'ACK", () => {
    expect(read("src/app/api/discord/interactions/route.ts")).toContain("if (runCommunity) after(runCommunity);");
  });

  it("documente l'interrupteur de /profil", () => {
    expect(read(".env.example")).toContain("DISCORD_PROFILE_COMMAND_ENABLED");
  });
});
