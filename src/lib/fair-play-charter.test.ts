import { describe, expect, it } from "vitest";
import { MAX_FAIR_PLAY_CHARTER_LENGTH, parseFairPlayCharter } from "./fair-play-charter";

describe("parseFairPlayCharter", () => {
  it("trims text and treats an empty charter as unset", () => {
    expect(parseFairPlayCharter("  Respecte les autres.\n")).toBe("Respecte les autres.");
    expect(parseFairPlayCharter("  ")).toBeNull();
  });

  it("rejects non-text and text beyond the storage limit", () => {
    expect(parseFairPlayCharter(null)).toBeNull();
    expect(parseFairPlayCharter("x".repeat(MAX_FAIR_PLAY_CHARTER_LENGTH + 1))).toBeNull();
    expect(parseFairPlayCharter("x".repeat(MAX_FAIR_PLAY_CHARTER_LENGTH))).toHaveLength(MAX_FAIR_PLAY_CHARTER_LENGTH);
  });
});
