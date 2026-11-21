import { describe, expect, it } from "vitest";
import { isMediaPrivacyEnabled, isSessionGalleryPeopleConsent } from "./media-privacy";

describe("media-privacy", () => {
  it("n'est actif que si MEDIA_PRIVACY_ENABLED vaut exactement « true »", () => {
    expect(isMediaPrivacyEnabled({ MEDIA_PRIVACY_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "false", " true"]) {
      expect(isMediaPrivacyEnabled({ MEDIA_PRIVACY_ENABLED: value })).toBe(false);
    }
  });

  it("exige la case cochée des personnes reconnaissables", () => {
    expect(isSessionGalleryPeopleConsent("on")).toBe(true);
    expect(isSessionGalleryPeopleConsent(null)).toBe(false);
    expect(isSessionGalleryPeopleConsent("yes")).toBe(false);
  });
});
