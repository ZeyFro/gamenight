import { describe, expect, it } from "vitest";
import { COMPETING_URL_VARIABLES, EXIT, RefusalError, assertExpectedPending, assertSingleUrlSource, assertTarget, diffMigrations, parseTarget, readArgs, redact } from "../../scripts/db-migrate-lib.mjs";

// Les URL sont assemblées pour ne pas déclencher src/lib/no-hosted-db-url.test.ts (aucune chaîne de connexion
// hébergée en dur dans src) : hôtes fictifs, jamais de domaine Neon.
const url = (user: string, password: string, host: string, database: string, query = "") =>
  `${"postgresql:"}//${user}:${password}@${host}/${database}${query}`;
const HOST = "db-direct.example.invalid";
const URL_MIGRATOR = url("gn_migrator", "s3cret-pass", HOST, "appdb", "?sslmode=require");
const URL_RUNTIME = url("gn_runtime", "other-pass", "db-direct-pooler.example.invalid", "appdb");
const ok = (name: string) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

describe("db-migrate : arguments", () => {
  it("lit les drapeaux et la liste attendue", () => {
    expect(readArgs(["--expect=a, b", "--execute", "--confirm-database=appdb", "--allow-local"]))
      .toEqual({ expect: ["a", "b"], execute: true, confirm: "appdb", allowLocal: true });
  });

  it("refuse une valeur sur les drapeaux booléens", () => {
    for (const arg of ["--execute=false", "--execute=", "--allow-local=non"]) expect(() => readArgs([arg])).toThrow(/drapeau sans valeur/);
    expect(readArgs(["--execute"]).execute).toBe(true);
  });

  it("refuse tout argument inconnu ou de forme `--nom valeur`", () => {
    expect(() => readArgs(["--exécute"])).toThrow(RefusalError);
    expect(() => readArgs(["--confirm-database", "appdb"])).toThrow(/inconnu/);
    expect(() => readArgs(["appdb"])).toThrow(/inconnu/);
  });
});

describe("db-migrate : cible", () => {
  it("décompose l'URL (hôte en minuscules, base décodée) sans exposer le mot de passe dans les champs d'affichage", () => {
    expect(parseTarget(URL_MIGRATOR)).toMatchObject({ host: HOST, database: "appdb", username: "gn_migrator", local: false, pooled: false });
    expect(parseTarget(url("u", "p", "DB-Direct.Example.INVALID:6543", "app%5Fdb")))
      .toMatchObject({ host: HOST, port: "6543", database: "app_db" });
    expect(parseTarget(url("u", "p", "[::1]:5432", "gamenight_x")).local).toBe(true);
  });

  it("refuse les paramètres d'URL hors liste blanche (host, schema, options…)", () => {
    for (const query of ["?host=autre.example.invalid", "?schema=autre", "?options=-c%20search_path%3Dx", "?sslmode=require&service=x"]) {
      expect(() => parseTarget(url("u", "p", "127.0.0.1", "gamenight_x", query))).toThrow(/non autorisé/);
    }
    expect(parseTarget(url("u", "p", HOST, "appdb", "?sslmode=require&connect_timeout=10")).database).toBe("appdb");
  });

  it("exige MIGRATION_DATABASE_URL", () => {
    expect(() => assertTarget({ migrationUrl: undefined, allowLocal: false })).toThrow(RefusalError);
  });

  it("refuse le même rôle que le runtime (URL ou nom de rôle) et avertit si le contrôle est impossible", () => {
    const base = { migrationUrl: url("gn_runtime", "x", HOST, "appdb"), expectedTarget: `${HOST}/appdb` };
    expect(() => assertTarget({ ...base, runtimeUrl: URL_RUNTIME })).toThrow(/autre rôle/);
    expect(() => assertTarget({ ...base, runtimeRole: "gn_runtime" })).toThrow(/autre rôle/);
    expect(assertTarget({ ...base, runtimeRole: "autre" }).warnings).toEqual([]);
    expect(assertTarget(base).warnings[0]).toMatch(/NON effectué/);
  });

  it("hors local : cible exacte (hôte, port facultatif, base), hôte poolé refusé", () => {
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR })).toThrow(/GAMENIGHT_EXPECTED_TARGET/);
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR, expectedTarget: "autre-hote.example.invalid/appdb" })).toThrow(/Cible inattendue/);
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR, expectedTarget: `${HOST}/autre` })).toThrow(/Cible inattendue/);
    expect(() => assertTarget({ migrationUrl: URL_MIGRATOR, expectedTarget: `${HOST}:6543/appdb` })).toThrow(/Cible inattendue/);
    const pooled = "db-direct-pooler.example.invalid";
    expect(() => assertTarget({ migrationUrl: url("gn_migrator", "x", pooled, "appdb"), expectedTarget: `${pooled}/appdb` })).toThrow(/poolé/);
    const { target } = assertTarget({ migrationUrl: URL_MIGRATOR, runtimeUrl: URL_RUNTIME, expectedTarget: `${HOST.toUpperCase()}:5432/appdb` });
    expect(target.database).toBe("appdb");
  });

  it("hors local, --execute exige le contrôle du rôle runtime (URL ou nom)", () => {
    const base = { migrationUrl: URL_MIGRATOR, expectedTarget: `${HOST}/appdb` };
    expect(() => assertTarget({ ...base, execute: true })).toThrow(/GAMENIGHT_RUNTIME_ROLE/);
    expect(assertTarget({ ...base, execute: false }).warnings[0]).toMatch(/NON effectué/);
    expect(assertTarget({ ...base, execute: true, runtimeRole: "gn_runtime" }).warnings).toEqual([]);
    expect(assertTarget({ ...base, execute: true, runtimeUrl: URL_RUNTIME }).warnings).toEqual([]);
  });

  it("local : --allow-local et base gamenight_* seulement", () => {
    const local = (db: string) => url("gn_migrator", "x", "127.0.0.1:55471", db);
    expect(() => assertTarget({ migrationUrl: local("gamenight_xp_x"), allowLocal: false })).toThrow(/--allow-local/);
    expect(() => assertTarget({ migrationUrl: local("appdb"), allowLocal: true })).toThrow(/gamenight_/);
    expect(assertTarget({ migrationUrl: local("gamenight_xp_x"), allowLocal: true }).target.local).toBe(true);
  });
});

describe("db-migrate : migrations en attente", () => {
  it("calcule en attente, inachevées et absentes du checkout", () => {
    const diff = diffMigrations(["a", "b", "c"], [ok("a"), { migration_name: "b", finished_at: null, rolled_back_at: null }, ok("z")]);
    expect(diff).toEqual({ finished: ["a", "z"], absentFromCheckout: ["z"], inProgress: ["b"], pending: ["b", "c"] });
  });

  it("n'accepte que la liste exacte attendue", () => {
    const base = { absentFromCheckout: [], inProgress: [] };
    expect(assertExpectedPending({ ...base, pending: ["x", "y"] }, ["x", "y"])).toEqual(["x", "y"]);
    expect(() => assertExpectedPending({ ...base, pending: ["x", "y"] }, ["x"])).toThrow(/Inattendues : \[y\]/);
    expect(() => assertExpectedPending({ ...base, pending: ["x"] }, ["x", "y"])).toThrow(/Manquantes : \[y\]/);
    expect(() => assertExpectedPending({ ...base, pending: [] }, [])).toThrow(/--expect/);
  });

  it("refuse une liste dans l'ordre inversé ou avec un doublon (même ensemble)", () => {
    const base = { absentFromCheckout: [], inProgress: [], pending: ["x", "y", "z"] };
    expect(() => assertExpectedPending(base, ["y", "x", "z"])).toThrow(/Ordre de --expect.*Attendu : \[x, y, z\].*Reçu : \[y, x, z\]/);
    expect(() => assertExpectedPending(base, ["z", "y", "x"])).toThrow(/Ordre/);
    expect(() => assertExpectedPending(base, ["x", "x", "y", "z"])).toThrow(/doublon : x/);
  });

  it("« rien à faire » reste un refus (code 2) mais le dit clairement ; manquante = appliquée ou absente du dossier", () => {
    const done = { absentFromCheckout: [], inProgress: [], pending: [], finished: ["x", "y"] };
    expect(() => assertExpectedPending(done, ["x", "y"])).toThrow(/^Rien à faire : aucune migration en attente.*déjà appliquées et terminées\. Aucune écriture/);
    try { assertExpectedPending(done, ["x", "y"]); } catch (error) { expect((error as RefusalError).exitCode).toBe(EXIT.REFUSED); }
    expect(() => assertExpectedPending(done, ["x", "inconnue"])).toThrow(/inconnue \(absente du dossier prisma\/migrations\)/);
    expect(() => assertExpectedPending({ ...done, pending: ["z"] }, ["x"])).toThrow(/Manquantes : \[x\].*x \(déjà appliquée\)/);
  });

  it("refuse une migration inachevée ou un historique plus récent que le checkout", () => {
    expect(() => assertExpectedPending({ absentFromCheckout: [], inProgress: ["b"], pending: ["b"] }, ["b"])).toThrow(/inachevée/);
    expect(() => assertExpectedPending({ absentFromCheckout: ["z"], inProgress: [], pending: ["c"] }, ["c"])).toThrow(/absentes du checkout/);
  });
});

describe("db-migrate : une seule source d'URL", () => {
  it("refuse toute variable d'URL concurrente (intégration Vercel/Neon, DIRECT_URL…)", () => {
    for (const name of COMPETING_URL_VARIABLES) expect(() => assertSingleUrlSource({ [name]: URL_RUNTIME }), name).toThrow(/cible ambiguë/);
    expect(() => assertSingleUrlSource({ DIRECT_URL: "" })).not.toThrow();
  });

  it("admet DATABASE_URL seule ou accordée à GAMENIGHT_RUNTIME_ROLE, refuse leur désaccord", () => {
    expect(() => assertSingleUrlSource({})).not.toThrow();
    expect(() => assertSingleUrlSource({ DATABASE_URL: URL_RUNTIME })).not.toThrow();
    expect(() => assertSingleUrlSource({ DATABASE_URL: URL_RUNTIME, GAMENIGHT_RUNTIME_ROLE: "gn_runtime" })).not.toThrow();
    expect(() => assertSingleUrlSource({ DATABASE_URL: URL_RUNTIME, GAMENIGHT_RUNTIME_ROLE: "autre" })).toThrow(/deux rôles runtime différents/);
  });
});

describe("db-migrate : secrets", () => {
  it("masque l'URL complète, le mot de passe et sa forme encodée", () => {
    const password = "s3cret pass/é";
    const text = `échec ${URL_MIGRATOR} mot de passe ${password} encodé ${encodeURIComponent(password)}`;
    const shown = redact(text, [URL_MIGRATOR, password]);
    expect(shown).not.toContain("s3cret");
    expect(shown).not.toContain("gn_migrator:");
  });

  it("expose des codes de sortie distincts", () => {
    expect(new Set(Object.values(EXIT)).size).toBe(5);
    expect(new RefusalError("x").exitCode).toBe(EXIT.REFUSED);
  });
});
