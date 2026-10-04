import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { closeThreadOnEndMock, loggerErrorMock } = vi.hoisted(() => ({
  closeThreadOnEndMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/discord-thread-cleanup", () => ({ closeThreadOnEnd: closeThreadOnEndMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() } }));

import { isThreadCloseOnEndEnabled, closeThreadOnEndSafely, THREAD_CLOSE_ON_END_FLAG } from "./thread-close-on-end";

const ALL_ON = {
  [THREAD_CLOSE_ON_END_FLAG]: "true",
  DISCORD_THREAD_CLEANUP_ENABLED: "true",
  DISCORD_THREAD_CLEANUP_MODE: "execute",
};

describe("isThreadCloseOnEndEnabled", () => {
  it("éteint par défaut (aucune variable)", () => {
    expect(isThreadCloseOnEndEnabled({})).toBe(false);
  });

  it("actif seulement si le nouveau drapeau ET le nettoyage existant en mode execute sont posés", () => {
    expect(isThreadCloseOnEndEnabled(ALL_ON)).toBe(true);
  });

  it.each([
    ["nouveau drapeau absent", { ...ALL_ON, [THREAD_CLOSE_ON_END_FLAG]: undefined }],
    ["nettoyage existant éteint", { ...ALL_ON, DISCORD_THREAD_CLEANUP_ENABLED: undefined }],
    ["nettoyage existant en dry-run (mode vide)", { ...ALL_ON, DISCORD_THREAD_CLEANUP_MODE: undefined }],
    ["nettoyage existant en dry-run (autre valeur)", { ...ALL_ON, DISCORD_THREAD_CLEANUP_MODE: "dry-run" }],
    ["nouveau drapeau seul", { [THREAD_CLOSE_ON_END_FLAG]: "true" }],
  ])("inactif : %s", (_label, env) => {
    expect(isThreadCloseOnEndEnabled(env)).toBe(false);
  });

  it.each(["TRUE", "True", "1", "yes", " true", "true "])("la valeur %j n'active pas le drapeau (exactement `true`)", (value) => {
    expect(isThreadCloseOnEndEnabled({ ...ALL_ON, [THREAD_CLOSE_ON_END_FLAG]: value })).toBe(false);
  });
});

describe("closeThreadOnEndSafely", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  function enableAll() {
    for (const [name, value] of Object.entries(ALL_ON)) vi.stubEnv(name, value);
  }

  it("drapeau éteint : ne charge ni n'appelle le nettoyage", async () => {
    await closeThreadOnEndSafely("session", "s1");
    expect(closeThreadOnEndMock).not.toHaveBeenCalled();
  });

  it("drapeau actif : délègue au nettoyage avec le type et l'identifiant", async () => {
    enableAll();
    await closeThreadOnEndSafely("tournament", "t1");
    expect(closeThreadOnEndMock).toHaveBeenCalledWith("tournament", "t1");
  });

  it("une panne est journalisée (jamais avalée en silence) et ne remonte jamais à la clôture", async () => {
    enableAll();
    const boom = new Error("base indisponible");
    closeThreadOnEndMock.mockRejectedValueOnce(boom);
    await expect(closeThreadOnEndSafely("session", "s1")).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledWith("thread-close-on-end", boom, { kind: "session", id: "s1" });
  });
});
