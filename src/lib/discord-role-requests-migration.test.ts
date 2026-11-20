import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../prisma/migrations/20261118130500_discord_role_requests/migration.sql", import.meta.url),
  "utf8"
);
const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

describe("migration 20261118130500_discord_role_requests", () => {
  it("est additive : aucune suppression ni modification de table existante", () => {
    const statements = sql
      .split("\n")
      .filter((line) => !line.startsWith("--") && line.trim())
      .join("\n");
    expect(statements).not.toMatch(/DROP |TRUNCATE|DELETE FROM|ALTER TABLE "(?!DiscordRoleRequest)/);
  });

  it("porte l'unicité (serveur, nom normalisé) et la cascade de communauté", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "DiscordRoleRequest_guildId_nameKey_key"');
    expect(sql).toContain('FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE');
    expect(schema).toContain("@@unique([guildId, nameKey])");
  });

  it("couvre chaque colonne du modèle Prisma", () => {
    const block = schema.slice(schema.indexOf("model DiscordRoleRequest {"));
    const columns = [...block.slice(0, block.indexOf("\n}")).matchAll(/^\s{2}(\w+)\s+\w+/gm)].map((match) => match[1]);
    for (const column of columns.filter((name) => name !== "community")) expect(sql, column).toContain(`"${column}"`);
  });
});
