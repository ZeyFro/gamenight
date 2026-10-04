import { describe, expect, it } from "vitest";
import {
  USER_COLOR_PALETTE,
  bannerFallbackStyle,
  hexToRgb,
  isValidHexColor,
  rgbToHex,
} from "./user-color";

describe("isValidHexColor", () => {
  it("accepte #RRGGBB en minuscules et majuscules", () => {
    expect(isValidHexColor("#8b5cf6")).toBe(true);
    expect(isValidHexColor("#8B5CF6")).toBe(true);
  });

  it.each(["8b5cf6", "#fff", "#8b5cf", "#8b5cf6a", "#gggggg", "", " #8b5cf6"])(
    "refuse %j",
    (value) => {
      expect(isValidHexColor(value)).toBe(false);
    }
  );

  it("toute la palette est valide et le violet est en premier", () => {
    expect(USER_COLOR_PALETTE[0].hex).toBe("#8b5cf6");
    for (const { hex } of USER_COLOR_PALETTE) expect(isValidHexColor(hex)).toBe(true);
  });
});

describe("hexToRgb", () => {
  it("convertit un hex valide", () => {
    expect(hexToRgb("#8b5cf6")).toEqual({ r: 139, g: 92, b: 246 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("renvoie null si invalide", () => {
    expect(hexToRgb("violet")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("renvoie un hex en majuscules", () => {
    expect(rgbToHex({ r: 139, g: 92, b: 246 })).toBe("#8B5CF6");
  });

  it("borne et arrondit les composantes", () => {
    expect(rgbToHex({ r: -10, g: 300, b: 127.6 })).toBe("#00FF80");
  });

  it("complète à deux chiffres", () => {
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
  });

  it("est l'inverse de hexToRgb", () => {
    const rgb = hexToRgb("#22c55e");
    expect(rgb && rgbToHex(rgb)).toBe("#22C55E");
  });
});

describe("bannerFallbackStyle", () => {
  it("injecte la couleur dans le dégradé de repli", () => {
    const { background } = bannerFallbackStyle("#ef4444");
    expect(background).toContain("color-mix(in srgb, #ef4444 55%, transparent)");
    expect(background).toContain("color-mix(in srgb, #ef4444 45%, transparent)");
    expect(background.endsWith("var(--surface)")).toBe(true);
  });
});
