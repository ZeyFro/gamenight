import { describe, expect, it } from "vitest";
import { parseTeamIdentity, safeTeamColor, TEAM_EMBLEMS } from "./team-identity";

describe("parseTeamIdentity", () => {
  it("accepte une couleur #RRGGBB (mise en minuscules) et un emblème de la liste", () => {
    expect(parseTeamIdentity("#FF8800", TEAM_EMBLEMS[0])).toEqual({ color: "#ff8800", emblem: TEAM_EMBLEMS[0] });
  });
  it("valeurs vides = retrait", () => {
    expect(parseTeamIdentity("", "")).toEqual({ color: null, emblem: null });
    expect(parseTeamIdentity(null, undefined)).toEqual({ color: null, emblem: null });
  });
  it("refuse une couleur ou un emblème hors règle (aucune injection de style possible)", () => {
    expect(parseTeamIdentity("red", "")).toBeNull();
    expect(parseTeamIdentity("#fff", "")).toBeNull();
    expect(parseTeamIdentity("#ff0000;background:url(x)", "")).toBeNull();
    expect(parseTeamIdentity("", "<img src=x>")).toBeNull();
    expect(parseTeamIdentity("", "💩")).toBeNull();
  });
  it("safeTeamColor ne renvoie qu'un code valide", () => {
    expect(safeTeamColor("#00aa11")).toBe("#00aa11");
    expect(safeTeamColor("javascript:1")).toBeNull();
    expect(safeTeamColor(null)).toBeNull();
  });
});
