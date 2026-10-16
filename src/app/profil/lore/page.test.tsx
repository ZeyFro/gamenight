import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/group-achievements", () => ({ listGroupAchievements: mocks.list }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import GroupLorePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.list.mockResolvedValue([
    { id: "one", name: "Première soirée", description: "1 soirée jouée.", icon: "🎮", unlockedAt: new Date("2026-01-02T00:00:00Z") },
    { id: "two", name: "Century", description: "100 soirées jouées.", icon: "💯", unlockedAt: null },
  ]);
});

describe("/profil/lore", () => {
  it("redirige les visiteurs anonymes avant de charger les trophées", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(GroupLorePage()).rejects.toThrow("REDIRECT:/");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("affiche les trophées débloqués et verrouillés de la communauté active du membre", async () => {
    const html = renderToStaticMarkup(await GroupLorePage());
    expect(mocks.list).toHaveBeenCalledWith("viewer");
    expect(html).toContain("Hall of Fame du groupe");
    expect(html).toContain("Débloqué le");
    expect(html).toContain("À débloquer");
    expect(html).toContain("1 trophée débloqué sur 2");
  });
});
