import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Garde de l'override `@vercel/cli-config` → `zod` de package.json.
 *
 * Pourquoi un override : `@vercel/blob` dépend de `@vercel/oidc` ^3.6.1, dont toutes les versions 3.x
 * épinglent `@vercel/cli-config` 0.2.x–0.3.1, lui-même épinglé sur `zod` 4.1.11 (avis GHSA-mrhx-c7xc-m3w5,
 * corrigé en 4.6.6). Le correctif amont (`cli-config` 0.3.6, `zod` ^4.6.6) n'existe que sous `oidc` 4.x,
 * qu'aucune version de `@vercel/blob` n'accepte encore. L'override fait donc utiliser à `cli-config` le
 * zod de l'application. À retirer quand `@vercel/blob` dépendra d'un `@vercel/oidc` corrigé.
 *
 * Ces tests exercent les fonctions de `cli-config` réellement appelées par `@vercel/oidc`
 * (lecture, écriture et stockage des identifiants) avec le zod surchargé, sur un dossier jetable.
 */
const requireFromHere = createRequire(import.meta.url);
const requireFromBlob = createRequire(requireFromHere.resolve("@vercel/blob"));
const requireFromOidc = createRequire(requireFromBlob.resolve("@vercel/oidc"));
const cliConfigEntry = requireFromOidc.resolve("@vercel/cli-config");
const requireFromCliConfig = createRequire(cliConfigEntry);

type CliConfig = {
  tryReadAuthConfig(configDir: string): Record<string, unknown> | null;
  writeAuthConfig(configDir: string, config: Record<string, unknown>): void;
  getLikelyEffectiveCredStorage(configDir: string): string;
};
const cliConfig = requireFromOidc("@vercel/cli-config") as CliConfig;

function zodVersion(resolve: NodeJS.Require): string {
  const entry = resolve.resolve("zod");
  const root = entry.slice(0, entry.lastIndexOf(join("node_modules", "zod")) + join("node_modules", "zod").length);
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
}

describe("override zod de @vercel/cli-config (chaîne @vercel/blob → @vercel/oidc)", () => {
  let dir: string;
  const previousStorage = process.env.VERCEL_TOKEN_STORAGE;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gn-cli-config-"));
    delete process.env.VERCEL_TOKEN_STORAGE;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.VERCEL_TOKEN_STORAGE;
    else process.env.VERCEL_TOKEN_STORAGE = previousStorage;
  });

  it("cli-config charge le même zod que l'application, dans une version corrigée (>= 4.6.6)", () => {
    expect(requireFromCliConfig.resolve("zod")).toBe(requireFromHere.resolve("zod"));
    const [major, minor, patch] = zodVersion(requireFromCliConfig).split(".").map(Number);
    expect(major).toBe(4);
    expect(minor > 6 || (minor === 6 && patch >= 6)).toBe(true);
  });

  // Comportement relevé à l'identique avec le zod épinglé d'origine (4.1.11) et avec le zod surchargé :
  // les champs inconnus sont conservés à la lecture.
  it("lit un fichier d'identifiants valide, champs inconnus conservés comme avant l'override", () => {
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ token: "jeton-de-test", userId: "u1", expiresAt: 1234, inconnu: true }));
    expect(cliConfig.tryReadAuthConfig(dir)).toEqual({ token: "jeton-de-test", userId: "u1", expiresAt: 1234, inconnu: true });
  });

  it("refuse un fichier d'identifiants mal typé, absent ou illisible sans lever d'erreur", () => {
    expect(cliConfig.tryReadAuthConfig(dir)).toBeNull();
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ token: 42 }));
    expect(cliConfig.tryReadAuthConfig(dir)).toBeNull();
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokenSource: "ailleurs" }));
    expect(cliConfig.tryReadAuthConfig(dir)).toBeNull();
    writeFileSync(join(dir, "auth.json"), "{ pas du json");
    expect(cliConfig.tryReadAuthConfig(dir)).toBeNull();
  });

  it("écrit puis relit les identifiants (encodage zod), fichier réservé au propriétaire", () => {
    cliConfig.writeAuthConfig(dir, { token: "jeton-de-test", refreshToken: "r", expiresAt: 99 });
    expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"))).toEqual({ token: "jeton-de-test", refreshToken: "r", expiresAt: 99 });
    expect(cliConfig.tryReadAuthConfig(dir)).toEqual({ token: "jeton-de-test", refreshToken: "r", expiresAt: 99 });
    if (process.platform !== "win32") expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o600);
    cliConfig.writeAuthConfig(dir, {});
    expect(cliConfig.tryReadAuthConfig(dir)).toEqual({});
  });

  it("refuse d'écrire des identifiants mal typés", () => {
    expect(() => cliConfig.writeAuthConfig(dir, { token: 42 })).toThrow();
    expect(cliConfig.tryReadAuthConfig(dir)).toBeNull();
  });

  it("valide le réglage de stockage des identifiants du fichier de configuration", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ credStorage: "file" }));
    expect(cliConfig.getLikelyEffectiveCredStorage(dir)).toBe("file");
    writeFileSync(join(dir, "config.json"), JSON.stringify({ credStorage: "nuage" }));
    expect(() => cliConfig.getLikelyEffectiveCredStorage(dir)).toThrow(/credStorage|nuage/);
  });
});
