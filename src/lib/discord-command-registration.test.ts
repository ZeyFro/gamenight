import { describe, expect, it } from "vitest";
import {
  checkRegistrationSecret,
  isCommandRegistrationEnabled,
  parseRegistrationMode,
  registrationHttpStatus,
  runCommandRegistration,
} from "./discord-command-registration";

describe("interrupteur DISCORD_COMMAND_REGISTRATION_ENABLED", () => {
  it("n'est actif que pour la valeur exacte « true »", () => {
    expect(isCommandRegistrationEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) {
      expect(isCommandRegistrationEnabled({ DISCORD_COMMAND_REGISTRATION_ENABLED: value })).toBe(false);
    }
    expect(isCommandRegistrationEnabled({ DISCORD_COMMAND_REGISTRATION_ENABLED: "true" })).toBe(true);
  });
});

describe("secret de route", () => {
  it("refuse un secret serveur absent ou vide, même avec un en-tête vide ou absent", () => {
    for (const expected of [undefined, "", "   "]) {
      expect(checkRegistrationSecret(expected, "")).toBe(false);
      expect(checkRegistrationSecret(expected, null)).toBe(false);
      expect(checkRegistrationSecret(expected, "quelque chose")).toBe(false);
    }
  });
  it("n'accepte que le secret exact", () => {
    expect(checkRegistrationSecret("abc123", "abc123")).toBe(true);
    for (const provided of [null, "", "abc12", "abc1234", "ABC123", "autre"]) expect(checkRegistrationSecret("abc123", provided)).toBe(false);
  });
});

describe("mode et code HTTP", () => {
  it("accepte seulement check et execute", () => {
    expect(parseRegistrationMode({ mode: "check" })).toBe("check");
    expect(parseRegistrationMode({ mode: "execute" })).toBe("execute");
    for (const body of [null, undefined, {}, { mode: "delete" }, { mode: "Check" }, "check", 3]) expect(parseRegistrationMode(body)).toBeNull();
  });
  it("200 si ok, 503 pour la configuration, 502 sinon", () => {
    const base = { mode: "check" as const, commands: [], outsideManifest: null };
    expect(registrationHttpStatus({ ...base, ok: true, failure: null })).toBe(200);
    expect(registrationHttpStatus({ ...base, ok: false, failure: { stage: "config" } })).toBe(503);
    expect(registrationHttpStatus({ ...base, ok: false, failure: { stage: "read", http: 403 } })).toBe(502);
  });
});

describe("runCommandRegistration", () => {
  it("sans configuration valide : aucune requête réseau", async () => {
    let calls = 0;
    const report = await runCommandRegistration("execute", {}, (async () => { calls += 1; return new Response("[]"); }) as typeof fetch);
    expect(calls).toBe(0);
    expect(report.failure).toEqual({ stage: "config" });
  });
});
