import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde de la migration `DiscordTeamSpace` (`20261118121000_discord_team_space`).
 *
 * Une migration présente dans `main` est appliquée automatiquement à Neon
 * Production par `migrate-production.yml` : la fusion vaut accord. Ce test fige
 * les bornes relues avant cette fusion, sans base ni réseau :
 * - uniquement additive : une table, ses index et ses clés étrangères, jamais de
 *   `DROP`, `DELETE`, `TRUNCATE`, `UPDATE` ni de modification de colonne ;
 * - les seules clés étrangères visent `Community` et `CommunityTeam` (#370) ;
 * - alignée avec le modèle déclaré dans `schema.prisma` ;
 * - postérieure à #370 et à la dernière migration de main au moment de sa création.
 */
const MIGRATION_DIR = "20261118121000_discord_team_space";
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const SQL = readFileSync(join(MIGRATIONS, MIGRATION_DIR, "migration.sql"), "utf8");
const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const migrationNames = (): string[] => readdirSync(MIGRATIONS).filter((name: string) => /^\d{14}_/.test(name)).sort();

/** Les commentaires SQL ne sont pas du DDL : on les retire avant d'analyser. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toUpperCase();

describe("migration DiscordTeamSpace — bornes avant fusion", () => {
  it("crée la table et ses index", () => {
    expect(STATEMENTS).toContain('CREATE TABLE "DISCORDTEAMSPACE"');
    expect(STATEMENTS).toContain('CREATE UNIQUE INDEX "DISCORDTEAMSPACE_TEAMID_KEY"');
    expect(STATEMENTS).toContain('CREATE UNIQUE INDEX "DISCORDTEAMSPACE_CHANNELID_KEY"');
    expect(STATEMENTS).toContain('CREATE INDEX "DISCORDTEAMSPACE_COMMUNITYID_IDX"');
  });

  it("ne détruit ni ne modifie aucune donnée ni table existante", () => {
    const sql = `\n${STATEMENTS}`;
    for (const forbidden of ["DROP ", "\nDELETE ", "TRUNCATE", "\nUPDATE ", "ALTER COLUMN", "RENAME", "DROP COLUMN"]) {
      expect(sql).not.toContain(forbidden);
    }
    const alters = STATEMENTS.match(/ALTER TABLE "[A-Z]+"/g) ?? [];
    expect([...new Set(alters)]).toEqual(['ALTER TABLE "DISCORDTEAMSPACE"']);
  });

  it("ne pose de clés étrangères que vers Community et CommunityTeam, en cascade", () => {
    const references = [...STATEMENTS.matchAll(/REFERENCES "([A-Z]+)"/g)].map((match) => match[1]);
    expect(references.sort()).toEqual(["COMMUNITY", "COMMUNITYTEAM"]);
    expect(STATEMENTS.match(/ON DELETE CASCADE/g)).toHaveLength(2);
  });

  it("reste alignée avec le modèle déclaré dans schema.prisma", () => {
    const model = /model DiscordTeamSpace \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(model).not.toBe("");
    for (const column of ["id", "teamId", "communityId", "guildId", "channelId", "roleId", "archived", "createdAt", "updatedAt"]) {
      expect(model).toContain(column);
      expect(STATEMENTS).toContain(`"${column.toUpperCase()}"`);
    }
  });

  it("ajoute le salon vocal permanent par une migration additive séparée (option A)", () => {
    const voiceDir = "20261118124000_discord_team_space_voice";
    expect(migrationNames()).toContain(voiceDir);
    expect(voiceDir > MIGRATION_DIR).toBe(true);
    const voice = readFileSync(join(MIGRATIONS, voiceDir, "migration.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toUpperCase();
    expect(voice).toContain('ALTER TABLE "DISCORDTEAMSPACE" ADD COLUMN "VOICECHANNELID" TEXT');
    expect(voice).toContain('CREATE UNIQUE INDEX "DISCORDTEAMSPACE_VOICECHANNELID_KEY"');
    for (const forbidden of ["DROP ", "\nDELETE ", "TRUNCATE", "\nUPDATE ", "ALTER COLUMN"]) {
      expect(`\n${voice}`).not.toContain(forbidden);
    }
    // Aucune autre table touchée par cette migration.
    expect(/ALTER TABLE "(?!DISCORDTEAMSPACE)/.test(voice)).toBe(false);
    // Le modèle Prisma déclare bien la colonne, nullable et unique.
    expect(/voiceChannelId\s+String\?\s+@unique/.test(SCHEMA)).toBe(true);
  });

  it("s'applique après #370 (équipes) et sans ancien nom", () => {
    const names = migrationNames();
    expect(names).toContain(MIGRATION_DIR);
    expect(MIGRATION_DIR > "20261118103100_profile_visibility").toBe(true);
    const team = names.find((name) => name.endsWith("_community_teams"));
    if (team) expect(MIGRATION_DIR > team).toBe(true);
    expect(existsSync(join(MIGRATIONS, "20261117120000_discord_team_space"))).toBe(false);
    expect(existsSync(join(MIGRATIONS, "20261201120000_discord_team_space"))).toBe(false);
  });
});
