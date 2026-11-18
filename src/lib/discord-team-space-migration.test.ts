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

  it("s'applique après #370 (équipes) et sans ancien nom", () => {
    const names = readdirSync(MIGRATIONS).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names).toContain(MIGRATION_DIR);
    expect(MIGRATION_DIR > "20261118103100_profile_visibility").toBe(true);
    const team = names.find((name) => name.endsWith("_community_teams"));
    if (team) expect(MIGRATION_DIR > team).toBe(true);
    expect(existsSync(join(MIGRATIONS, "20261117120000_discord_team_space"))).toBe(false);
    expect(existsSync(join(MIGRATIONS, "20261201120000_discord_team_space"))).toBe(false);
  });
});
