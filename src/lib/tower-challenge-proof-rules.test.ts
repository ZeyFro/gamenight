import { describe, expect, it } from "vitest";
import {
  createTowerChallengeProofCode,
  detectTowerProofVariant,
  proofTextIncludesTowerCode,
  towerProofSatisfiesCodeRule,
  towerTvPhotoReviewHint,
} from "./tower-challenge-proof-rules";
import { getPendingProofAgingAction } from "./tower-challenge-aging-rules";

describe("code de preuve Tower", () => {
  it("génère un code TWR opaque de huit caractères sans glyphes ambigus", () => {
    expect(createTowerChallengeProofCode()).toMatch(/^TWR-[A-HJ-NP-Z2-9]{8}$/);
  });

  it("accepte le code dans la description de la preuve, sans dépendre de la casse", () => {
    expect(proofTextIncludesTowerCode("Capture jointe, twr-abcd2345", "TWR-ABCD2345")).toBe(true);
    expect(proofTextIncludesTowerCode("Capture jointe", "TWR-ABCD2345")).toBe(false);
  });
});

describe("variante photo d'écran TV avec code", () => {
  const code = "TWR-ABCD2345";
  it("accepte la mention photo TV sans code dans le texte (le code doit être lisible sur la photo)", () => {
    for (const text of ["Photo TV du résultat", "photo d'écran TV, code sur la photo", "[TV] voilà", "Photo de l’écran TV"]) {
      expect(towerProofSatisfiesCodeRule(text, code)).toBe(true);
      expect(detectTowerProofVariant(text, code)).toBe("TV_PHOTO_WITH_CODE");
    }
  });
  it("le code dans le texte reste la variante normale", () => {
    expect(detectTowerProofVariant("capture twr-abcd2345 photo TV", code)).toBe("CODE_IN_TEXT");
  });
  it("sans code ni mention TV : refusé", () => {
    expect(towerProofSatisfiesCodeRule("Capture jointe", code)).toBe(false);
    expect(towerProofSatisfiesCodeRule("la tv est allumée", code)).toBe(false);
  });
  it("consigne aux votants seulement pour la variante TV, jamais de validation automatique", () => {
    expect(towerTvPhotoReviewHint("photo TV", code)).toContain(code);
    expect(towerTvPhotoReviewHint("code TWR-ABCD2345", code)).toBeNull();
  });
});

describe("vieillissement des preuves sans quorum", () => {
  const base = {
    status: "SUBMITTED",
    submittedAt: new Date("2026-11-01T12:00:00Z"),
    now: new Date("2026-11-01T12:00:00Z"),
    qualifyingVoteCount: 0,
    staffReportedAt: null,
    archivedAt: null,
    hasOpenAppeal: false,
  };

  it("signale au staff à J+7 exactement", () => {
    expect(getPendingProofAgingAction({ ...base, now: new Date("2026-11-08T12:00:00Z") })).toBe("REPORT_STAFF");
  });

  it("archive à J+30 uniquement après le signalement staff", () => {
    expect(getPendingProofAgingAction({
      ...base,
      now: new Date("2026-12-01T12:00:00Z"),
      staffReportedAt: new Date("2026-11-08T12:00:00Z"),
    })).toBe("ARCHIVE");
  });

  it.each([
    { status: "APPROVED", qualifyingVoteCount: 0 },
    { status: "SUBMITTED", qualifyingVoteCount: 3 },
    { status: "SUBMITTED", qualifyingVoteCount: 0, hasOpenAppeal: true },
    { status: "SUBMITTED", qualifyingVoteCount: 0, archivedAt: new Date("2026-11-30T12:00:00Z") },
  ])("ignore un dossier qui n'est plus en attente sans quorum: %j", overrides => {
    expect(getPendingProofAgingAction({
      ...base,
      ...overrides,
      now: new Date("2026-12-02T12:00:00Z"),
      staffReportedAt: new Date("2026-11-08T12:00:00Z"),
    })).toBeNull();
  });
});
