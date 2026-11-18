import { describe, expect, it } from "vitest";
import {
  TOWER_SOLO_IMPORT_PACK, TOWER_TEAM_IMPORT_PACK, towerChallengeDefinitionContentSchema,
} from "./tower-challenge-import-packs";
import { TOWER_S1_SOLO_CHALLENGES } from "./tower-s1-solo-catalogue";
import { TOWER_S1_TEAM_CHALLENGES } from "./tower-s1-team-catalogue";

type Entry = { title: string; instructions: string; rewardFloors: number };
const key = (title: string) => title.trim().toLowerCase();
const PURCHASE = /achat|acheter|payant|abonnement|dlc|boutique/i;
const FREE = /gratuit/i;
const AFTER_ATTRIBUTION = /postérieure? à l[’']attribution/i;
const NO_REUSE = /jamais réutilisée/i;
const AI_VALIDATION = /\b(IA|intelligence artificielle|ChatGPT)\b/;

/** Règles du cahier (§18-20) appliquées à une entrée, en plus du parseur réel. */
function problems(entry: Entry): string[] {
  const found: string[] = [];
  if (!towerChallengeDefinitionContentSchema.safeParse(entry).success) found.push("rejeté par le parseur d'import");
  if (![1, 2, 3].includes(entry.rewardFloors)) found.push("barème hors +1/+2/+3");
  if (PURCHASE.test(entry.instructions) && !FREE.test(entry.instructions)) found.push("achat sans alternative gratuite");
  if (!AFTER_ATTRIBUTION.test(entry.instructions)) found.push("preuve non datée après l'attribution");
  if (!NO_REUSE.test(entry.instructions)) found.push("réutilisation d'un exploit non interdite");
  if (AI_VALIDATION.test(entry.instructions)) found.push("validation par IA");
  return found;
}

describe("catalogue S1 — lu par /tower-admin importer et importer-equipe", () => {
  it("fournit au moins 60 défis solo (20 faciles, 25 moyens, 15 difficiles)", () => {
    expect(TOWER_S1_SOLO_CHALLENGES.length).toBeGreaterThanOrEqual(60);
    const by = (n: number) => TOWER_S1_SOLO_CHALLENGES.filter(c => c.rewardFloors === n).length;
    expect([by(1), by(2), by(3)]).toEqual([20, 25, 15]);
  });
  it("fournit au moins 20 défis d'équipe", () => {
    expect(TOWER_S1_TEAM_CHALLENGES.length).toBeGreaterThanOrEqual(20);
  });
  it("est réellement dans les packs lus par les deux imports", () => {
    for (const c of TOWER_S1_SOLO_CHALLENGES) expect(TOWER_SOLO_IMPORT_PACK).toContain(c);
    for (const c of TOWER_S1_TEAM_CHALLENGES) expect(TOWER_TEAM_IMPORT_PACK).toContain(c);
  });
  it("passe le parseur réel et les règles du cahier, solo et équipe", () => {
    for (const c of [...TOWER_S1_SOLO_CHALLENGES, ...TOWER_S1_TEAM_CHALLENGES]) {
      expect({ title: c.title, problems: problems(c) }).toEqual({ title: c.title, problems: [] });
    }
  });
  it("n'a aucun titre en double (la déduplication d'import se fait sur le titre en minuscules)", () => {
    for (const pack of [TOWER_SOLO_IMPORT_PACK, TOWER_TEAM_IMPORT_PACK]) {
      const titles = pack.map(c => key(c.title));
      expect(new Set(titles).size).toBe(titles.length);
    }
    for (const c of [...TOWER_S1_SOLO_CHALLENGES, ...TOWER_S1_TEAM_CHALLENGES]) expect(c.title).toBe(c.title.trim());
  });
  it("couvre Minecraft, compétitif, coop, découverte et création", () => {
    const text = [...TOWER_S1_SOLO_CHALLENGES, ...TOWER_S1_TEAM_CHALLENGES].map(c => c.title + " " + c.instructions).join(" ");
    for (const word of [/Minecraft/, /compétitif/, /coop/i, /découvr|inconnu/i, /créat|construi|bâti/i]) expect(text).toMatch(word);
  });

  describe("cas négatifs : le contrôle refuse un défi hors règles", () => {
    const ok: Entry = {
      title: "Valide", rewardFloors: 2,
      instructions: "Fais quelque chose. Preuve postérieure à l’attribution, jamais réutilisée d’un autre défi. Aucun achat requis : un jeu gratuit convient.",
    };
    it("accepte l'entrée de référence", () => expect(problems(ok)).toEqual([]));
    it("refuse un titre vide ou trop long", () => {
      expect(problems({ ...ok, title: "  " })).toContain("rejeté par le parseur d'import");
      expect(problems({ ...ok, title: "x".repeat(121) })).toContain("rejeté par le parseur d'import");
    });
    it("refuse une consigne trop longue", () => {
      expect(problems({ ...ok, instructions: ok.instructions + "x".repeat(1500) })).toContain("rejeté par le parseur d'import");
    });
    it("refuse un barème hors +1/+2/+3", () => {
      expect(problems({ ...ok, rewardFloors: 4 })).toContain("barème hors +1/+2/+3");
      expect(problems({ ...ok, rewardFloors: 0 })).toContain("rejeté par le parseur d'import");
      expect(problems({ ...ok, rewardFloors: 1.5 })).toContain("rejeté par le parseur d'import");
    });
    it("refuse un achat sans alternative gratuite", () => {
      expect(problems({ ...ok, instructions: ok.instructions.replace("Aucun achat requis : un jeu gratuit convient.", "Achète le DLC.") }))
        .toContain("achat sans alternative gratuite");
    });
    it("refuse une preuve non postérieure à l'attribution", () => {
      expect(problems({ ...ok, instructions: ok.instructions.replace("Preuve postérieure à l’attribution, ", "Preuve ") }))
        .toContain("preuve non datée après l'attribution");
    });
    it("refuse l'absence d'anti-réutilisation", () => {
      expect(problems({ ...ok, instructions: ok.instructions.replace("jamais réutilisée d’un autre défi", "au choix") }))
        .toContain("réutilisation d'un exploit non interdite");
    });
    it("refuse une validation par IA", () => {
      expect(problems({ ...ok, instructions: ok.instructions + " Une IA valide la preuve." })).toContain("validation par IA");
    });
    it("détecte un doublon de titre par la clé d'import", () => {
      expect(key(" Le Titre ")).toBe(key("le titre"));
    });
  });
});
