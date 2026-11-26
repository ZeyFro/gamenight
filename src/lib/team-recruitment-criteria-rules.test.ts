import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeTeamCriteria, isEmptyTeamCriteria, isTeamRecruitmentCriteriaEnabled, parseTeamRecruitmentCriteriaForm,
  teamRecruitmentCriteriaSchema, type TeamRecruitmentCriteriaView,
} from "./team-recruitment-criteria-rules";

afterEach(() => vi.unstubAllEnvs());

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

describe("drapeau TEAM_RECRUITMENT_CRITERIA_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    vi.stubEnv("TEAM_RECRUITMENT_CRITERIA_ENABLED", value as string);
    expect(isTeamRecruitmentCriteriaEnabled()).toBe(expected);
  });
});

describe("schéma des critères", () => {
  const valid = { teamId: "t1", goals: ["DETENTE"], minLevel: "AVANCE", mic: "REQUIRED", slots: ["NIGHT"], platforms: ["PC"], note: null };

  it("accepte une saisie complète et vide", () => {
    expect(teamRecruitmentCriteriaSchema.safeParse(valid).success).toBe(true);
    expect(teamRecruitmentCriteriaSchema.safeParse({ ...valid, goals: [], minLevel: null, mic: null, slots: [], platforms: [] }).success).toBe(true);
  });
  it("dédoublonne objectifs, créneaux et plateformes (casse ignorée)", () => {
    const parsed = teamRecruitmentCriteriaSchema.parse({ ...valid, goals: ["DETENTE", "DETENTE"], slots: ["NIGHT", "NIGHT"], platforms: ["PC", "pc", " PS5 "] });
    expect(parsed).toMatchObject({ goals: ["DETENTE"], slots: ["NIGHT"], platforms: ["PC", "PS5"] });
  });
  it.each([
    ["objectif inconnu", { goals: ["TRICHE"] }],
    ["niveau inconnu", { minLevel: "DIEU" }],
    ["micro inconnu", { mic: "MAYBE" }],
    ["créneau inconnu", { slots: ["MIDI"] }],
    ["plus de 5 plateformes", { platforms: ["a", "b", "c", "d", "e", "f"] }],
    ["plateforme trop longue", { platforms: ["x".repeat(41)] }],
    ["précisions trop longues", { note: "x".repeat(301) }],
    ["équipe vide", { teamId: "  " }],
    ["champ inconnu (communityId forgé)", { communityId: "autre" }],
  ])("refuse : %s", (_label, override) => {
    expect(teamRecruitmentCriteriaSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("lecture du formulaire", () => {
  it("lit cases multiples, listes et plateformes séparées par des virgules", () => {
    const parsed = parseTeamRecruitmentCriteriaForm(form([
      ["teamId", "t1"], ["goals", "DETENTE"], ["goals", "COMPETITIF"], ["minLevel", "INTERMEDIAIRE"], ["mic", "PREFERRED"],
      ["slots", "WEEKEND_EVENING"], ["platforms", "PC, PS5 ,, "], ["note", "  Soirs calmes  "],
    ]));
    expect(parsed.success && parsed.data).toMatchObject({
      teamId: "t1", goals: ["DETENTE", "COMPETITIF"], minLevel: "INTERMEDIAIRE", mic: "PREFERRED",
      slots: ["WEEKEND_EVENING"], platforms: ["PC", "PS5"], note: "Soirs calmes",
    });
  });
  it("traite les champs facultatifs vides comme non renseignés", () => {
    const parsed = parseTeamRecruitmentCriteriaForm(form([["teamId", "t1"], ["minLevel", ""], ["mic", ""], ["platforms", "  "], ["note", ""]]));
    expect(parsed.success && parsed.data).toMatchObject({ goals: [], minLevel: null, mic: null, slots: [], platforms: [], note: null });
  });
  it("rejette une valeur hors énumération forgée dans le formulaire", () => {
    expect(parseTeamRecruitmentCriteriaForm(form([["teamId", "t1"], ["goals", "ADMIN"]])).success).toBe(false);
    expect(parseTeamRecruitmentCriteriaForm(form([["goals", "DETENTE"]])).success).toBe(false);
  });
});

describe("affichage", () => {
  const empty: TeamRecruitmentCriteriaView = { goals: [], minLevel: null, mic: null, slots: [], platforms: [], note: null };
  it("détecte l'absence de critère", () => {
    expect(isEmptyTeamCriteria(undefined)).toBe(true);
    expect(isEmptyTeamCriteria({ ...empty, goals: [], slots: [] })).toBe(true);
    expect(isEmptyTeamCriteria({ ...empty, mic: "REQUIRED" })).toBe(false);
  });
  it("décrit les critères dans un ordre stable, sans ligne vide", () => {
    expect(describeTeamCriteria({ ...empty })).toEqual([]);
    expect(describeTeamCriteria({ goals: ["DETENTE", "SOCIAL"], minLevel: "EXPERT", mic: "REQUIRED", slots: ["NIGHT"], platforms: ["PC"], note: "ok" }).map((row) => row.label))
      .toEqual(["Objectifs", "Niveau de jeu minimum", "Micro", "Créneaux (heure de Paris)", "Plateformes", "Précisions"]);
    expect(describeTeamCriteria({ ...empty, mic: "NOT_NEEDED", goals: ["COMPETITIF"] })).toEqual([
      { label: "Objectifs", values: ["Compétitif"] }, { label: "Micro", values: ["Micro facultatif"] },
    ]);
  });
});
