import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Hook SessionStart des sessions cloud (.claude/hooks/session-start.mjs) : il prépare un Postgres
 * LOCAL JETABLE pour les tests d'intégration. CLAUDE.md exige les réglages sans durabilité (sinon
 * les TRUNCATE ... CASCADE de ~100 tables expirent et la suite passe de ~283 s à 930-1222 s) et
 * interdit toute base distante. Garde statique : le hook n'est exécuté que dans une session cloud.
 */
const source = readFileSync(new URL("../../.claude/hooks/session-start.mjs", import.meta.url), "utf8");

describe("hook session-start : Postgres de test local", () => {
  it("n'agit que dans une session cloud et vise exclusivement 127.0.0.1", () => {
    expect(source).toContain('process.env.CLAUDE_CODE_REMOTE !== "true"');
    expect(source).toContain('const HOST = "127.0.0.1"');
    expect(source).toMatch(/hostname !== HOST\) fail\(/);
    expect(source).not.toMatch(/postgres(ql)?:\/\/[^$\s`'"]*@(?!\$\{HOST\})/);
  });

  it("démarre le cluster avec les cinq réglages sans durabilité exigés par CLAUDE.md", () => {
    const block = source.match(/const PG_FAST_SETTINGS = \[([\s\S]*?)\];/)?.[1] ?? "";
    for (const setting of ["fsync=off", "synchronous_commit=off", "full_page_writes=off", "checkpoint_timeout=1h", "max_wal_size=8GB"]) {
      expect(block, setting).toContain(`"${setting}"`);
    }
    // Les réglages sont réellement transmis à pg_ctl (option -o), pas seulement déclarés.
    expect(source).toMatch(/"-o", `[^`]*PG_FAST_SETTINGS\.map\(\(setting\) => `-c \$\{setting\}`\)\.join\(" "\)/);
  });

  it("applique les migrations sur la base locale uniquement (DATABASE_URL écrasée)", () => {
    expect(source).toContain("DATABASE_URL: TEST_DATABASE_URL");
  });
});
