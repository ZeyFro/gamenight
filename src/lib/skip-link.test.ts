import { describe, expect, it } from "vitest";
import { isSkipLinkEnabled, SKIP_LINK_TARGET_ID } from "./skip-link";

describe("isSkipLinkEnabled", () => {
  it("seule la valeur exacte « true » active", () => {
    expect(isSkipLinkEnabled({ SKIP_LINK_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "yes", " true", "false"]) {
      expect(isSkipLinkEnabled({ SKIP_LINK_ENABLED: value })).toBe(false);
    }
  });

  it("la cible est un identifiant HTML valide", () => {
    expect(SKIP_LINK_TARGET_ID).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
