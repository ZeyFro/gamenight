import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cahier §27.3 / D16 : « V2 : bot gateway permanent et rangs importés
 * (documentation seulement) ».
 *
 * La V2 n'est pas livrée : seuls des documents la décrivent après le lancement.
 * Ce garde-fou vérifie qu'aucun interrupteur, client d'API ou intent privilégié
 * ne peut l'activer par erreur. La seule passerelle du dépôt est celle des
 * présences vocales v1.1, ouverte uniquement si `VOICE_PRESENCE_ENABLED=true`,
 * et elle s'identifie avec `GUILDS` + `GUILD_VOICE_STATES` (1 | 128), jamais
 * `GUILD_MEMBERS` (2) ni `GUILD_PRESENCES` (256).
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) =>
    statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]
  );
}

const sourceFiles = walk("src").filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file)
);
const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const envExample = readFileSync(".env.example", "utf8");
const charges = readFileSync("docs/CAHIER_DES_CHARGES.md", "utf8");
const final = readFileSync("docs/CAHIER_FINAL.md", "utf8");
const plan = readFileSync("docs/PLAN-J14-20261201.md", "utf8");
const gateway = readFileSync("src/lib/discord-voice-gateway.ts", "utf8");

describe("D16 — la V2 reste une documentation, sans activation possible", () => {
  it("les documents situent la V2 après le lancement et ne la livrent pas", () => {
    expect(charges).toContain("### 27.3. V2 — documenter seulement");
    expect(charges).toMatch(/bot gateway permanent.*rangs importés/);
    expect(final).toMatch(/\| C101 \|.*Feuille de route, après le lancement/);
    expect(final).toMatch(/\| D16 \|.*documentation seulement/);
    expect(plan).toMatch(/V2 \(bot gateway, rangs importés\).*documentation seulement/);
  });

  it("aucun interrupteur ni clé d'API de la V2 n'est documenté", () => {
    const forbidden = [
      "DISCORD_GATEWAY_ENABLED",
      "DISCORD_ACTIVITY_ENABLED",
      "RANK_IMPORT_ENABLED",
      "RIOT_API_KEY",
      "HYPIXEL_API_KEY",
    ];
    for (const name of forbidden) {
      expect(envExample).not.toMatch(new RegExp(`^${name}=`, "m"));
      expect(source).not.toContain(name);
    }
  });

  it("aucun rang n'est importé depuis une API Riot ou Hypixel", () => {
    expect(source).not.toMatch(/api\.riotgames\.com|api\.hypixel\.net/);
    expect(source).not.toMatch(/RIOT_API|HYPIXEL_API/);
  });

  it("la seule passerelle Discord reste éteinte par défaut", () => {
    expect(envExample).toMatch(/^VOICE_PRESENCE_ENABLED=$/m);
    expect(gateway).toContain('env.VOICE_PRESENCE_ENABLED !== "true"');
  });

  it("la passerelle ne demande aucun intent privilégié", () => {
    const identify = gateway.match(/intents:\s*([0-9\s|]+)/);
    expect(identify).not.toBeNull();
    const intents = identify![1]
      .split("|")
      .map((part) => Number(part.trim()))
      .filter((value) => value > 0);
    expect(intents.sort((a, b) => a - b)).toEqual([1, 128]);
    expect(gateway).not.toMatch(/GUILD_MEMBERS|GUILD_PRESENCES/);
  });
});
