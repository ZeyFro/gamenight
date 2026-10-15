import { describe, expect, it } from "vitest";
import { playerEquipmentSchema } from "./player-equipment";

const valid = { inputDevices: ["KEYBOARD_MOUSE", "CONTROLLER"], availablePlatforms: ["WINDOWS", "SWITCH"], microphoneAvailable: "no" };

describe("carnet de matériel", () => {
  it("conserve plusieurs commandes et plateformes et distingue non de non renseigné", () => {
    expect(playerEquipmentSchema.parse(valid)).toEqual({ ...valid, microphoneAvailable: false });
    expect(playerEquipmentSchema.parse({ inputDevices: [], availablePlatforms: [], microphoneAvailable: "" })).toEqual({ inputDevices: [], availablePlatforms: [], microphoneAvailable: null });
    expect(playerEquipmentSchema.parse({ ...valid, microphoneAvailable: "yes" }).microphoneAvailable).toBe(true);
  });
  it("déduplique sans inventer de plateforme", () => {
    expect(playerEquipmentSchema.parse({ ...valid, availablePlatforms: ["WINDOWS", "WINDOWS"] }).availablePlatforms).toEqual(["WINDOWS"]);
  });
  it.each([
    { inputDevices: ["forged"] }, { availablePlatforms: ["unknown"] }, { microphoneAvailable: "true" },
    { inputDevices: Array(20).fill("CONTROLLER") }, { availablePlatforms: Array(100).fill("WINDOWS") },
    { microphoneAvailable: null }, { availablePlatforms: [new Blob(["x"])] },
  ])("refuse un formulaire hors contrat %j", overrides => {
    expect(playerEquipmentSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });
});
