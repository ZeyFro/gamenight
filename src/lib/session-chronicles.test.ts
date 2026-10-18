import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionChronicleInput, isSessionChroniclesEnabled } from "./session-chronicle-input";

afterEach(() => vi.unstubAllEnvs());
describe("chroniques de soirée", () => {
  it("nettoie le texte et permet l'effacement volontaire", () => {
    expect(sessionChronicleInput.parse("  Un beau clutch !  ")).toBe("Un beau clutch !");
    expect(sessionChronicleInput.parse(" \n ")).toBe(null);
  });
  it.each([null, {}, "x".repeat(10001)])("refuse une saisie invalide", value => {
    expect(sessionChronicleInput.safeParse(value).success).toBe(false);
  });
  it("reste désactivé sauf true explicite", () => {
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "TRUE");
    expect(isSessionChroniclesEnabled()).toBe(false);
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "true");
    expect(isSessionChroniclesEnabled()).toBe(true);
  });
});
