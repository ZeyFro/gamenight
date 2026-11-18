import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appliedBoosterPerks,
  BOOSTER_BADGE_LABEL,
  BOOSTER_FORBIDDEN,
  BOOSTER_PERK_DEFINITIONS,
  BOOSTER_TEAM_DESCRIPTION_CHARS,
  describeBoosterStatus,
  preparingBoosterPerks,
  renderBoosterAdvantages,
} from "./boost-perks";

const root = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("catalogue des avantages Booster", () => {
  it("déclare un état réel par avantage, jamais une intention vague", () => {
    for (const perk of BOOSTER_PERK_DEFINITIONS) {
      expect(["APPLIED", "PREPARING"]).toContain(perk.availability);
      expect(perk.label.length).toBeGreaterThan(10);
    }
    const keys = BOOSTER_PERK_DEFINITIONS.map((perk) => perk.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("n’annonce comme appliqués que des avantages réellement présents dans le produit", () => {
    // Les deux seuls avantages codés aujourd'hui : le badge vérifié et l'anneau
    // d'avatar, tous deux dans /profil. Tout le reste est en préparation.
    expect(appliedBoosterPerks().map((perk) => perk.key)).toEqual(["profileBadge", "profileRing"]);
    expect(preparingBoosterPerks().map((perk) => perk.key)).toEqual([
      "extendedBanner",
      "extraProfileSection",
      "teamSpaceCustomization",
      "boosterChannels",
    ]);
  });

  it("ne contient aucune clé de permission, de vote ou de multiplicateur", () => {
    const keys = BOOSTER_PERK_DEFINITIONS.map((perk) => perk.key.toLowerCase());
    for (const forbidden of ["admin", "permission", "moderation", "vote", "multiplier", "floor", "xp", "quota"]) {
      expect(keys.some((key) => key.includes(forbidden)), forbidden).toBe(false);
    }
  });

  it("déclare explicitement les six interdits produit", () => {
    const list = BOOSTER_FORBIDDEN.join(" | ");
    expect(BOOSTER_FORBIDDEN).toHaveLength(6);
    expect(list).toContain("administration");
    expect(list).toContain("votes de validation");
    expect(list).toContain("multiplicateur d’étages");
    expect(list).toContain("classement");
    expect(list).toContain("rôle sensible");
    expect(list).toContain("illimitée");
  });

  it("borne la personnalisation d’équipe : une décoration, pas un pouvoir", () => {
    expect(BOOSTER_TEAM_DESCRIPTION_CHARS).toBe(300);
  });
});

describe("statut Booster lisible", () => {
  it("rappelle qu’aucune donnée n’est supprimée sans boost", () => {
    const text = describeBoosterStatus({ active: false, since: null });
    expect(text).toContain("ne boosts pas");
    expect(text).toContain("restent intactes");
  });

  it("affiche une date Discord quand le boost est actif", () => {
    const text = describeBoosterStatus({ active: true, since: "2026-11-01T10:00:00.000Z" });
    expect(text).toMatch(/<t:\d+:D>/);
    expect(text).toContain("Statut Booster vérifié");
  });

  it("reste prudent sur un horodatage inconnu", () => {
    expect(describeBoosterStatus({ active: true, since: "pas une date" })).toContain("Statut Booster vérifié");
  });
});

describe("/boost — contenu", () => {
  const active = () => renderBoosterAdvantages({ active: true, since: "2026-11-01T10:00:00.000Z", enabled: true });

  it("reste fermé quand la fonctionnalité n’est pas activée, sans promettre d’avantage", () => {
    const text = renderBoosterAdvantages({ active: false, since: null, enabled: false });
    expect(text).toContain("pas encore ouverts");
    expect(text).toContain("Aucun avantage Booster n’est appliqué");
    expect(text).not.toContain("Déjà appliqué");
  });

  it("sépare appliqué, en préparation et interdit", () => {
    const text = active();
    const appliedAt = text.indexOf("**Déjà appliqué dans GameNight**");
    const preparingAt = text.indexOf("**En préparation");
    const forbiddenAt = text.indexOf("**Ce que le boost ne donne jamais**");
    expect(appliedAt).toBeGreaterThan(0);
    expect(preparingAt).toBeGreaterThan(appliedAt);
    expect(forbiddenAt).toBeGreaterThan(preparingAt);
    // Chaque section ne contient que ses propres avantages.
    for (const perk of appliedBoosterPerks()) {
      expect(text.slice(appliedAt, preparingAt)).toContain(perk.label);
      expect(text.slice(preparingAt, forbiddenAt)).not.toContain(perk.label);
    }
    for (const perk of preparingBoosterPerks()) {
      expect(text.slice(preparingAt, forbiddenAt)).toContain(perk.label);
      expect(text.slice(appliedAt, preparingAt)).not.toContain(perk.label);
    }
  });

  it("marque explicitement chaque avantage non terminé « en préparation »", () => {
    const text = active();
    for (const perk of preparingBoosterPerks()) {
      expect(text).toContain(`${perk.label} — _en préparation_`);
    }
    expect(preparingBoosterPerks().every((perk) => perk.availability === "PREPARING")).toBe(true);
  });

  it("n’affirme jamais qu’un avantage en préparation est actif, même pour un booster", () => {
    const activeText = active();
    expect(activeText).toContain("pas encore actif, même en boostant");
    const inactiveText = renderBoosterAdvantages({ active: false, since: null, enabled: true });
    expect(inactiveText).toContain("**En préparation — pas encore actif**");
    expect(inactiveText).not.toContain("même en boostant");
  });

  it("ne promet aucun avantage permanent, faute d’historique conservé", () => {
    expect(active()).toContain("Aucun historique de boost n’est conservé : rien n’est permanent.");
  });

  it("dit que le statut est lu côté serveur, jamais depuis le navigateur", () => {
    expect(active()).toContain("côté serveur — jamais depuis ton navigateur");
  });
});

describe("cohérence Discord ↔ GameNight", () => {
  it("n’utilise qu’une seule définition d’avantage pour les deux surfaces", () => {
    const layout = read("src/app/profil/layout.tsx");
    const commands = read("src/lib/discord-community-commands.ts");
    // Le badge et `/boost` lisent le même module : aucune liste recopiée.
    expect(layout).toContain("@/lib/booster-profile");
    expect(layout).toContain("@/components/BoosterBadge");
    expect(commands).toContain("@/lib/boost-perks");
    expect(commands).not.toMatch(/Bannière de profil|salons communautaires réservés/);
  });

  it("le badge web porte le libellé partagé, et n’est rendu que sur statut vérifié", () => {
    const badge = read("src/components/BoosterBadge.tsx");
    expect(badge).toContain("@/lib/boost-perks");
    expect(badge).toContain("BOOSTER_BADGE_LABEL");
    expect(badge).toContain('state.kind !== "ACTIVE"');
    expect(BOOSTER_BADGE_LABEL).toBe("Booster The Tower");
  });

  it("la distinction web recoupe bien un avantage déclaré APPLIED", () => {
    const badgePerk = BOOSTER_PERK_DEFINITIONS.find((perk) => perk.key === "profileBadge");
    expect(badgePerk?.availability).toBe("APPLIED");
    expect(badgePerk?.label).toContain(BOOSTER_BADGE_LABEL);
  });
});
