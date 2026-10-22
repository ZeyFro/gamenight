import { describe, expect, it } from "vitest";
import { EXIT, RefusalError, assertExpectedPending, assertTarget, diffMigrations, parseTarget, redact } from "../../scripts/db-migrate-lib.mjs";

const ok = (name: string) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });
const URL_MIGRATOR = "postgresql://gn_migrator:s3cret-pass@ep-direct.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const URL_RUNTIME = "postgresql://gn_runtime:other-pass@ep-direct-pooler.eu-central-1.aws.neon.tech/neondb";

describe("db-migrate : cible", () => {
  it("décompose l'URL sans exposer le mot de passe dans les champs d'affichage", () => {
    const target = parseTarget(URL_MIGRATOR);
    expect(target).toMatchObject({ host: "ep-direct.eu-central-1.aws.neon.tech", database: "neondb", username: "gn_migrator", local: false, pooled: false });
  });

  it("exige MIGRATION_DATABASE_URL", () => {
    expect(() => assertTarget({ migrationUrl: undefined, allowLocal: false })).toThrow(RefusalError);
  });

  it("refuse le même rôle pour la migration et le runtime", () => {
    expect(() => assertTarget({
      migrationUrl: "postgresql://gn_runtime:x@ep-direct.eu-central-1.aws.neon.tech/neondb",
      runtimeUrl: URL_RUNTIME,
      expectedTarget: "ep-direct.eu-central-1.aws.neon.tech/neondb",
    })).toThrow(/autre rôle/);
  });

  it("hors local : cible exacte obligatoire, hôte poolé refusé", () => {
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR })).toThrow(/GAMENIGHT_EXPECTED_TARGET/);
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR, expectedTarget: "autre-hote.example/neondb" })).toThrow(/Cible inattendue/);
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR.replace("ep-direct", "ep-direct-pooler"), expectedTarget: "ep-direct-pooler.eu-central-1.aws.neon.tech/neondb" })).toThrow(/poolé/);
    expect(assertTarget({ migrationUrl: URL_MIGRATOR, runtimeUrl: URL_RUNTIME, expectedTarget: "EP-DIRECT.eu-central-1.aws.neon.tech/neondb" }).database).toBe("neondb");
  });

  it("local : --allow-local et base gamenight_* seulement", () => {
    const local = (db: string) => `postgresql://gn_migrator:x@127.0.0.1:55471/${db}`;
    expect(() => assertTarget({ migrationUrl: local("gamenight_xp_x"), allowLocal: false })).toThrow(/--allow-local/);
    expect(() => assertTarget({ migrationUrl: local("neondb"), allowLocal: true })).toThrow(/gamenight_/);
    expect(assertTarget({ migrationUrl: local("gamenight_xp_x"), allowLocal: true }).local).toBe(true);
  });
});

describe("db-migrate : migrations en attente", () => {
  it("calcule en attente, inachevées et absentes du checkout", () => {
    const diff = diffMigrations(["a", "b", "c"], [ok("a"), { migration_name: "b", finished_at: null, rolled_back_at: null }, ok("z")]);
    expect(diff).toEqual({ absentFromCheckout: ["z"], inProgress: ["b"], pending: ["b", "c"] });
  });

  it("n'accepte que la liste exacte attendue", () => {
    const base = { absentFromCheckout: [], inProgress: [] };
    expect(assertExpectedPending({ ...base, pending: ["x", "y"] }, ["y", "x"])).toEqual(["x", "y"]);
    expect(() => assertExpectedPending({ ...base, pending: ["x", "y"] }, ["x"])).toThrow(/Inattendues : \[y\]/);
    expect(() => assertExpectedPending({ ...base, pending: ["x"] }, ["x", "y"])).toThrow(/Manquantes : \[y\]/);
    expect(() => assertExpectedPending({ ...base, pending: [] }, [])).toThrow(/--expect/);
  });

  it("refuse une migration inachevée ou un historique plus récent que le checkout", () => {
    expect(() => assertExpectedPending({ absentFromCheckout: [], inProgress: ["b"], pending: ["b"] }, ["b"])).toThrow(/inachevée/);
    expect(() => assertExpectedPending({ absentFromCheckout: ["z"], inProgress: [], pending: ["c"] }, ["c"])).toThrow(/absentes du checkout/);
  });
});

describe("db-migrate : secrets", () => {
  it("masque l'URL complète et le mot de passe", () => {
    const text = `échec sur ${URL_MIGRATOR} (mot de passe s3cret-pass)`;
    const shown = redact(text, [URL_MIGRATOR, "s3cret-pass"]);
    expect(shown).not.toContain("s3cret-pass");
    expect(shown).not.toContain("gn_migrator:");
  });

  it("expose des codes de sortie distincts", () => {
    expect(new Set(Object.values(EXIT)).size).toBe(5);
    expect(new RefusalError("x").exitCode).toBe(EXIT.REFUSED);
  });
});
