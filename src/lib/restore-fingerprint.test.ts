import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatFingerprint } from "../../scripts/restore-fingerprint.mjs";

const sql = readFileSync("scripts/restore-fingerprint.sql", "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, ["scripts/restore-fingerprint.mjs"], {
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });

describe("requête d'empreinte (statique)", () => {
  it("ne contient que des SELECT en lecture, une seule instruction", () => {
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|COPY)\b/i);
    expect(statements.trim().endsWith(";")).toBe(true);
    expect(statements.trim().slice(0, -1)).not.toContain(";");
    expect(statements).toMatch(/^\s*SELECT /);
  });

  it("ne lit que des compteurs et des dates, pas de donnée personnelle", () => {
    for (const personal of ["email", "displayname", "discord", "token", "password", "avatar"]) {
      expect(statements.toLowerCase()).not.toContain(personal);
    }
  });

  it("formate chaque mesure sur une ligne", () => {
    expect(formatFingerprint([{ mesure: "User", valeur: "7" }, { mesure: "Game", valeur: "3" }])).toEqual(["User : 7", "Game : 3"]);
  });
});

describe("script d'empreinte : garde-fous sans base", () => {
  it("refuse une URL absente ou poolée, sans l'afficher", () => {
    const missing = run({});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("REFUSÉ");
    const pooled = run({ DATABASE_URL: "postgresql://ep-x-pooler.eu.example/db" });
    expect(pooled.status).toBe(1);
    expect(pooled.stderr).toContain("pooler");
    expect(pooled.stderr + pooled.stdout).not.toContain("ep-x");
  });
});

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("empreinte contre une vraie base PostgreSQL de test", () => {
  it("écrit toutes les mesures attendues, sans URL", () => {
    const result = run({ DATABASE_URL: testUrl! });
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout;
    for (const measure of [
      "migrations_terminees", "derniere_migration", "User", "Community", "Membership", "CommunityTeam",
      "CommunityTeamMember", "Game", "Session", "XpEvent", "session_la_plus_recente", "xp_event_le_plus_recent",
    ]) {
      expect(out).toMatch(new RegExp(`^${measure} : `, "m"));
    }
    const migrations = Number(out.match(/^migrations_terminees : (\d+)$/m)?.[1]);
    expect(migrations).toBeGreaterThan(100);
    expect(out).not.toContain("postgresql://");
    expect(out).not.toContain("postgres:test");
  });

  it("est déterministe : deux exécutions successives donnent les mêmes compteurs", () => {
    const strip = (text: string) => text.split("\n").filter((line) => !line.startsWith("Empreinte prise")).join("\n");
    const first = run({ DATABASE_URL: testUrl! });
    const second = run({ DATABASE_URL: testUrl! });
    expect(strip(first.stdout)).toBe(strip(second.stdout));
  });
});
