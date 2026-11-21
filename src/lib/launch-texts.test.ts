import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GALLERY_UNAVAILABLE_NOTICE,
  TOWER_FLOORS_RESET_NOTICE,
  isLaunchTextsEnabled,
  isNavTowerEnabled,
  shouldShowSessionGallery,
  shouldShowVoicePresence,
} from "./launch-texts";

describe("interrupteurs d'ouverture", () => {
  it("seule la valeur exacte « true » active chacun des deux", () => {
    expect(isLaunchTextsEnabled({ LAUNCH_TEXTS_ENABLED: "true" })).toBe(true);
    expect(isNavTowerEnabled({ NAV_TOWER_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "yes", " true", "false"]) {
      expect(isLaunchTextsEnabled({ LAUNCH_TEXTS_ENABLED: value })).toBe(false);
      expect(isNavTowerEnabled({ NAV_TOWER_ENABLED: value })).toBe(false);
    }
  });

  it("les deux interrupteurs sont indépendants", () => {
    expect(isLaunchTextsEnabled({ NAV_TOWER_ENABLED: "true" })).toBe(false);
    expect(isNavTowerEnabled({ LAUNCH_TEXTS_ENABLED: "true" })).toBe(false);
  });
});

describe("phrase décidée le 18/11 sur les étages", () => {
  it("reprend mot pour mot la phrase de docs/SOIREE_ACTIVATION.md", () => {
    const doc = readFileSync("docs/SOIREE_ACTIVATION.md", "utf8");
    expect(doc).toContain(`**${TOWER_FLOORS_RESET_NOTICE}**`);
  });
});

describe("présence vocale de /sessions/[id] (V3-18)", () => {
  it("éteint, le bloc reste rendu comme avant dès qu'il existe", () => {
    expect(shouldShowVoicePresence({ enabled: false }, false)).toBe(true);
    expect(shouldShowVoicePresence({ enabled: true }, false)).toBe(true);
    expect(shouldShowVoicePresence(null, false)).toBe(false);
  });
  it("allumé, un bloc dont la collecte est désactivée disparaît", () => {
    expect(shouldShowVoicePresence({ enabled: false }, true)).toBe(false);
    expect(shouldShowVoicePresence({ enabled: true }, true)).toBe(true);
    expect(shouldShowVoicePresence(null, true)).toBe(false);
  });
});

describe("galerie de /sessions/[id] (V3-18)", () => {
  const base = { galleryEnabled: true, storageReady: false, canManage: false };
  it("éteint, la galerie activée reste rendue même sans stockage (comportement d'avant)", () => {
    expect(shouldShowSessionGallery({ ...base, launchTexts: false })).toBe(true);
    expect(shouldShowSessionGallery({ ...base, galleryEnabled: false, launchTexts: false })).toBe(false);
  });
  it("allumé, sans stockage : cachée au membre ordinaire, gardée pour qui gère le contenu", () => {
    expect(shouldShowSessionGallery({ ...base, launchTexts: true })).toBe(false);
    expect(shouldShowSessionGallery({ ...base, canManage: true, launchTexts: true })).toBe(true);
  });
  it("allumé, stockage prêt : rendue pour tous ; fonction éteinte : jamais", () => {
    expect(shouldShowSessionGallery({ ...base, storageReady: true, launchTexts: true })).toBe(true);
    expect(shouldShowSessionGallery({ galleryEnabled: false, storageReady: true, canManage: true, launchTexts: true })).toBe(false);
  });
  it("le message de remplacement n'a plus de jargon", () => {
    expect(GALLERY_UNAVAILABLE_NOTICE).toBe("Les photos ne sont pas encore disponibles.");
    expect(GALLERY_UNAVAILABLE_NOTICE).not.toMatch(/blob|igdb/i);
  });
});
