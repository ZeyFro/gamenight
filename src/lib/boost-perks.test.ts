import { describe, expect, it } from "vitest";
import {
  BOOSTER_FORBIDDEN,
  BOOSTER_PERKS,
  BOOSTER_TEAM_DESCRIPTION_CHARS,
  boosterPerks,
  describeBoosterStatus,
  renderBoosterAdvantages,
} from "./boost-perks";

describe("avantages Booster", () => {
  it("ne donne rien sans boost actif", () => {
    expect(boosterPerks(false)).toBeNull();
  });

  it("donne uniquement des avantages esthétiques ou d’accès", () => {
    const perks = boosterPerks(true);
    expect(perks).toEqual(BOOSTER_PERKS);
    expect(perks).toMatchObject({
      extendedBanner: true,
      extraProfileSection: true,
      badgeLabel: "Booster The Tower",
      boosterChannels: true,
    });
    expect(perks!.teamSpaceCustomization.descriptionChars).toBe(BOOSTER_TEAM_DESCRIPTION_CHARS);
    expect(BOOSTER_TEAM_DESCRIPTION_CHARS).toBeLessThanOrEqual(500);
  });

  it("ne contient aucune clé de permission, de vote ou de multiplicateur", () => {
    const keys = Object.keys(BOOSTER_PERKS).map((key) => key.toLowerCase());
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
    expect(text).toContain("Avantages Booster actifs");
  });

  it("reste prudent sur un horodatage inconnu", () => {
    expect(describeBoosterStatus({ active: true, since: "pas une date" })).toContain("Avantages Booster actifs");
  });
});

describe("/boost — contenu", () => {
  it("reste fermé quand la fonctionnalité n’est pas activée", () => {
    expect(renderBoosterAdvantages({ active: false, since: null, enabled: false })).toContain("pas encore ouverts");
  });

  it("liste les avantages ET sépare nettement les interdits", () => {
    const text = renderBoosterAdvantages({ active: true, since: "2026-11-01T10:00:00.000Z", enabled: true });
    expect(text).toContain("Booster The Tower");
    expect(text).toContain("Bannière de profil");
    expect(text).toContain("salons communautaires réservés");
    expect(text).toContain("récompenses déjà obtenues restent");
    const forbiddenStart = text.indexOf("Ce que le boost ne donne jamais");
    expect(forbiddenStart).toBeGreaterThan(0);
    for (const forbidden of ["administration", "votes de validation", "multiplicateur d’étages"]) {
      expect(text.indexOf(forbidden)).toBeGreaterThan(forbiddenStart);
    }
  });
});
