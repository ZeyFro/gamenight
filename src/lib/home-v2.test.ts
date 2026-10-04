import { describe, expect, it } from "vitest";
import { isHomeV2Enabled } from "./home-v2";

describe("isHomeV2Enabled", () => {
  it("seule la valeur exacte « true » active la page", () => {
    expect(isHomeV2Enabled({ HOME_V2_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "yes", " true", "false"]) {
      expect(isHomeV2Enabled({ HOME_V2_ENABLED: value })).toBe(false);
    }
  });
});
