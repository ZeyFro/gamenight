import { afterEach, describe, expect, it, vi } from "vitest";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";

// Cas limites complémentaires à tower-config.test.ts (fichier réservé, non modifié).
const LEGACY = "553922938101825536";
const OWNER = "699223334046531636";
const digits = (n: number) => "1".repeat(n);

describe("towerGuildId : bornes 17-20 chiffres", () => {
  it("accepte 17, 18, 19 et 20 chiffres", () => {
    for (const n of [17, 18, 19, 20]) {
      expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: digits(n) }), `${n} chiffres`).toBe(digits(n));
    }
  });

  it("replie sur la valeur historique à 16 et 21 chiffres", () => {
    for (const n of [16, 21]) {
      expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: digits(n) }), `${n} chiffres`).toBe(LEGACY);
    }
  });

  it("retire les espaces, tabulations et retours à la ligne autour d'un identifiant valide", () => {
    expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: `\t${digits(18)}\n` })).toBe(digits(18));
    expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: `  ${digits(17)}  ` })).toBe(digits(17));
  });

  it("replie sur la valeur historique pour une valeur non numérique ou mal formée", () => {
    const invalid = [
      "ABCDEFGHIJKLMNOPQR",
      "abcdefabcdefabcdef",
      "0x" + digits(18),
      "-" + digits(18),
      "+" + digits(18),
      digits(18) + ".0",
      "1e17" + digits(14),
      "123456789 012345678",
      "１２３４５６７８９０１２３４５６７８", // chiffres pleine chasse
    ];
    for (const value of invalid) {
      expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: value }), value).toBe(LEGACY);
    }
  });
});

describe("towerGuildId : lecture de process.env par défaut", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("suit process.env.TOWER_DISCORD_GUILD_ID quand elle est valide", () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", digits(19));
    expect(towerGuildId()).toBe(digits(19));
  });

  it("conserve le repli historique quand elle est absente ou invalide (comportement actuel)", () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "");
    expect(towerGuildId()).toBe(LEGACY);
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "pas-un-identifiant");
    expect(towerGuildId()).toBe(LEGACY);
  });
});

describe("isTowerOwner : comparaison stricte", () => {
  it("refuse un identifiant numérique (type number), même égal en apparence", () => {
    expect(isTowerOwner(Number(OWNER) as unknown as string)).toBe(false);
    expect(isTowerOwner(BigInt(OWNER) as unknown as string)).toBe(false);
  });

  it("refuse les objets, tableaux et booléens", () => {
    for (const value of [{ toString: () => OWNER }, [OWNER], true, new String(OWNER)]) {
      expect(isTowerOwner(value as unknown as string)).toBe(false);
    }
  });

  it("refuse les variantes de forme : espaces internes, préfixe, suffixe, retour à la ligne, chiffres pleine chasse", () => {
    const variants = [
      `${OWNER}\n`,
      `\t${OWNER}`,
      OWNER.slice(0, 9) + " " + OWNER.slice(9),
      "0" + OWNER,
      OWNER + "0",
      OWNER.slice(0, -1),
      `<@${OWNER}>`,
      `${OWNER}n`,
      OWNER.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d))),
    ];
    for (const value of variants) expect(isTowerOwner(value), value).toBe(false);
  });

  it("refuse l'identifiant du serveur Tower (pas un compte)", () => {
    expect(isTowerOwner(LEGACY)).toBe(false);
  });

  it("ne suit pas TOWER_DISCORD_GUILD_ID", () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "111111111111111111");
    try {
      expect(isTowerOwner("111111111111111111")).toBe(false);
      expect(isTowerOwner(OWNER)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
