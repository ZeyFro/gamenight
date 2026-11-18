import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde de la migration `DiscordTeamSpace` (PR #444).
 *
 * Depuis la fusion de #445, une migration présente dans `main` est appliquée
 * automatiquement à Neon Production par `migrate-production.yml` : la fusion
 * vaut accord. Ce test fige les bornes relues avant cette fusion, sans base et
 * sans réseau :
 * - la migration reste additive et idempotente (`IF NOT EXISTS`), jamais un
 *   `DROP`, `DELETE`, `TRUNCATE` ou une modification d'une table existante ;
 * - elle ne pose aucune clé étrangère : le schéma Prisma ne déclare pas de
 *   relation, le nettoyage est applicatif ;
 * - elle est bien dans `prisma/migrations` (et non dans un dossier en attente),
 *   donc cohérente avec le modèle déclaré dans `schema.prisma`.
 */
const MIGRATION_DIR = "20261201120000_discord_team_space";
const SQL = readFileSync(join(process.cwd(), "prisma", "migrations", MIGRATION_DIR, "migration.sql"), "utf8");
const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/** Les commentaires SQL ne sont pas du DDL : on les retire avant d'analyser. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toUpperCase();

describe("migration DiscordTeamSpace — bornes avant fusion", () => {
  it("crée la table et ses index de façon idempotente", () => {
    expect(STATEMENTS).toContain('CREATE TABLE IF NOT EXISTS "DISCORDTEAMSPACE"');
    expect(STATEMENTS).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "DISCORDTEAMSPACE_TEAMID_KEY"');
    expect(STATEMENTS).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "DISCORDTEAMSPACE_CHANNELID_KEY"');
    expect(STATEMENTS).toContain('CREATE INDEX IF NOT EXISTS "DISCORDTEAMSPACE_COMMUNITYID_IDX"');
  });

  it("ne détruit ni ne modifie aucune donnée existante", () => {
    for (const forbidden of ["DROP ", "DELETE ", "TRUNCATE", "ALTER TABLE", "UPDATE "]) {
      expect(STATEMENTS).not.toContain(forbidden);
    }
  });

  it("ne pose aucune clé étrangère vers une table d'une autre PR", () => {
    expect(STATEMENTS).not.toContain("FOREIGN KEY");
    expect(STATEMENTS).not.toContain("REFERENCES");
  });

  it("reste alignée avec le modèle déclaré dans schema.prisma", () => {
    const model = /model DiscordTeamSpace \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(model).not.toBe("");
    for (const column of ["id", "teamId", "communityId", "guildId", "channelId", "roleId", "archived"]) {
      expect(model).toContain(column);
      expect(STATEMENTS).toContain(`"${column.toUpperCase()}"`);
    }
  });
});
