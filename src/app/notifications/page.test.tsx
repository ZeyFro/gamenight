import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw Error("NOT_FOUND"); },
  redirect: (url: string) => { throw Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { userGame: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma: async () => ({ notification: { findMany: async () => [] } }) }));
vi.mock("@/lib/game-ping-optin", async () => ({
  ...(await vi.importActual<typeof import("@/lib/game-ping-optin")>("@/lib/game-ping-optin")),
  listOwnGamePingOptIns: async () => [],
}));

import NotificationCenterPage, { generateMetadata } from "./page";

beforeEach(() => {
  vi.stubEnv("PAGE_TITLES_ENABLED", "true");
  mocks.user.mockResolvedValue({ id: "u1" });
});
afterEach(() => vi.unstubAllEnvs());

const props = { searchParams: Promise.resolve({}) };

describe("/notifications : le titre d'onglet ne ment pas", () => {
  it("centre éteint : la page est 404 ET le titre n'annonce pas « Notifications »", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "false");
    expect(generateMetadata()).toEqual({ title: "Introuvable" });
    await expect(NotificationCenterPage(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("centre allumé : titre « Notifications » et la page s'affiche", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    expect(generateMetadata()).toEqual({ title: "Notifications" });
    await expect(NotificationCenterPage(props)).resolves.toBeTruthy();
  });
  it("titres de page éteints : aucun titre propre dans les deux cas", () => {
    vi.stubEnv("PAGE_TITLES_ENABLED", "false");
    expect(generateMetadata()).toEqual({});
  });
});

describe("la cloche ne mène pas à une page introuvable", () => {
  it("l'en-tête ne donne le lien /notifications que centre allumé", () => {
    const header = readFileSync("src/components/Header.tsx", "utf8");
    expect(header).toMatch(/isNotificationCenterEnabled\(\) \? "\/notifications"/);
  });
});
