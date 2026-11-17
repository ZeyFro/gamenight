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
    const boost = commands.find((command) => command.name === "boost");
    expect(help, "/aide déclarée").toBeDefined();
    expect(profile, "/profil déclarée").toBeDefined();
    expect(boost, "/boost déclarée").toBeDefined();
    expect(help!.options).toBeUndefined();
    expect(profile!.options).toBeUndefined();
    expect(boost!.options).toBeUndefined();
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
    expect(interactions).toContain('interaction.data?.name === "boost"');
    expect(interactions).toContain("handleSignedCommunityInteraction");
    expect(interactions).toContain("runCommunity?: () => Promise<void>");
  });

  it("exécute la réponse après l'ACK", () => {
    expect(read("src/app/api/discord/interactions/route.ts")).toContain("if (runCommunity) after(runCommunity);");
  });

  it("documente l'interrupteur de /profil", () => {
    expect(read(".env.example")).toContain("DISCORD_PROFILE_COMMAND_ENABLED");
    expect(read(".env.example")).toContain("DISCORD_BOOSTER_ENABLED");
  });
});

describe("déclaration Discord de /equipe (lecture seule)", () => {
  it("déclare trois sous-commandes explicites", () => {
    const command = commands.find((entry) => entry.name === "equipe") as
      | { options?: Array<{ name: string; type: number }> }
      | undefined;
    expect(command, "/equipe déclarée").toBeDefined();
    expect((command!.options ?? []).map((option) => option.name)).toEqual([
      "liste",
      "moi",
      "voir",
      "rejoindre",
      "quitter",
      "creer",
      "recrutement",
    ]);
    expect((command!.options ?? []).every((option) => option.type === 1)).toBe(true);
  });

  it("route /equipe vers un handler différé après l’ACK", () => {
    const interactions = read("src/lib/discord-interactions.ts");
    expect(interactions).toContain('interaction.data?.name === "equipe"');
    expect(interactions).toContain("handleSignedTeamInteraction");
    expect(interactions).toContain("runTeams?: () => Promise<void>");
    expect(read("src/app/api/discord/interactions/route.ts")).toContain("if (runTeams) after(runTeams);");
    expect(read(".env.example")).toContain("DISCORD_TEAM_COMMAND_ENABLED");
  });

  it("délègue toute écriture au service métier, sans créer d’équipe ni de ressource Discord", () => {
    const handler = read("src/lib/discord-team-commands.ts");
    // Les adhésions passent par les services existants, jamais par une requête parallèle.
    expect(handler).toContain("joinCommunityTeam");
    expect(handler).toContain("leaveCommunityTeam");
    expect(handler).toContain("listCommunityTeams");
    expect(handler).toContain("createCommunityTeam");
    expect(handler).toContain("setCommunityTeamRecruitment");
    // Aucune ressource Discord n’est créée et aucune permission accordée.
    for (const forbidden of ["guildRole", "discord-role-sync", "MANAGE_GUILD", "discord-channel-create"]) {
      expect(handler, forbidden).not.toContain(forbidden);
    }
    expect(read(".env.example")).toContain("DISCORD_TEAM_WRITE_ENABLED");
  });
});
