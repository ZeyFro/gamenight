import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ login: vi.fn(), user: vi.fn() }));
vi.mock("@/auth", () => ({ signIn: mocks.login }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Error("Le lien ne doit pas se perdre vers l'accueil"); } }));

function action(element: ReactElement) {
  const child = (element.props as { children: ReactElement }).children;
  return (child.props as { action: () => Promise<void> }).action;
}
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue(null); });
describe("liens Discord : conserver la destination à la connexion", () => {
  it("planning : revient sur le formulaire après OAuth", async () => {
    const { default: page } = await import("./disponibilites/page");
    await action(await page())();
    expect(mocks.login).toHaveBeenCalledWith("discord", { redirectTo: "/disponibilites" });
  });
  it("Steam : conserve l'étape, sans accepter une URL externe comme étape", async () => {
    const { default: page } = await import("./bienvenue/page");
    await action((await page({ searchParams: Promise.resolve({ step: "steam" }) }))!)();
    expect(mocks.login).toHaveBeenLastCalledWith("discord", { redirectTo: "/bienvenue?step=steam" });
    await action((await page({ searchParams: Promise.resolve({ step: "https://foreign.test" }) }))!)();
    expect(mocks.login).toHaveBeenLastCalledWith("discord", { redirectTo: "/bienvenue" });
  });
  it("partie immédiate : conserve l'id et encode les caractères de chemin", async () => {
    const { default: page } = await import("./jouer-maintenant/[id]/page");
    await action(await page({ params: Promise.resolve({ id: "partie" }) }))();
    expect(mocks.login).toHaveBeenLastCalledWith("discord", { redirectTo: "/jouer-maintenant/partie" });
    await action(await page({ params: Promise.resolve({ id: "../https://foreign.test" }) }))();
    expect(mocks.login).toHaveBeenLastCalledWith("discord", { redirectTo: "/jouer-maintenant/..%2Fhttps%3A%2F%2Fforeign.test" });
  });
});
