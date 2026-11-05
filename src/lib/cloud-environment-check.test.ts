import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateCloudSettings } from "../../scripts/check-cloud-environment.mjs";

describe("précontrôle Cloud sans accès distant", () => {
  const settings = { nodeVersion: "22.23.4", databaseUrl: "postgresql://postgres:test@127.0.0.1:55439/gamenight_test", tlsVerification: undefined, ignoreChecksum: undefined };
  const remoteUrl = new URL("postgresql://example.invalid/db");
  remoteUrl.username = "user";
  remoteUrl.password = "private";

  it("accepte Node 22 et une base locale de test", () => {
    expect(() => validateCloudSettings(settings)).not.toThrow();
  });
  it.each(["20.19.0", "24.22.1"])("refuse Node %s", nodeVersion => {
    expect(() => validateCloudSettings({ ...settings, nodeVersion })).toThrow(/Node.js 22/);
  });
  it.each([undefined, "", "not-a-url", remoteUrl.href, "https://127.0.0.1/db", "postgresql://localhost/prod?host=remote.example", "postgresql://localhost/db?host=/tmp"])("refuse une cible absente, distante ou redirigée", databaseUrl => {
    expect(() => validateCloudSettings({ ...settings, databaseUrl })).toThrow(/TEST_DATABASE_URL/);
  });
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepte le loopback %s", host => {
    expect(() => validateCloudSettings({ ...settings, databaseUrl: `postgresql://${host}/gamenight_test` })).not.toThrow();
  });
  it("ne révèle pas les identifiants dans une erreur de cible", () => {
    expect(() => validateCloudSettings({ ...settings, databaseUrl: remoteUrl.href }))
      .toThrow(/^TEST_DATABASE_URL doit viser le loopback sans redirection host$/);
  });
  it("refuse les contournements de TLS et de checksum", () => {
    expect(() => validateCloudSettings({ ...settings, tlsVerification: "0" })).toThrow(/TLS/);
    expect(() => validateCloudSettings({ ...settings, ignoreChecksum: "1" })).toThrow(/checksum/);
  });
  it("quitte en échec sans révéler une URL distante ni lancer les étapes Prisma", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/check-cloud-environment.mjs", import.meta.url))], {
      env: { ...process.env, TEST_DATABASE_URL: remoteUrl.href },
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("configuration");
    expect(result.stderr).not.toMatch(/private|example\.invalid/);
  });
});
