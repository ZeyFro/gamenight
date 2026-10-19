import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), user: vi.fn(), create: vi.fn(), revoke: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/calendar-feed", () => ({ isCalendarFeedEnabled: mocks.enabled, createCalendarFeedToken: mocks.create, revokeCalendarFeedToken: mocks.revoke }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "Trop de requêtes." }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { manageCalendarFeedAction } from "./feed-actions";

const form = (mode = "create") => { const data = new FormData(); data.set("mode", mode); data.set("userId", "victim"); return data; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled.mockReturnValue(true); mocks.user.mockResolvedValue({ id: "self" });
  mocks.rate.mockReturnValue(true); mocks.create.mockResolvedValue({ token: "private-token", communityName: "Mes potes" }); mocks.revoke.mockResolvedValue(true);
});

describe("gestion authentifiée du lien iCal", () => {
  it("exige le flag et la session avant toute mutation", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await manageCalendarFeedAction({}, form())).toHaveProperty("error");
    mocks.enabled.mockReturnValue(true); mocks.user.mockResolvedValue(null);
    expect(await manageCalendarFeedAction({}, form())).toHaveProperty("error");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("crée pour la session, ignore userId forgé et ne renvoie le secret que dans le nouveau lien", async () => {
    expect(await manageCalendarFeedAction({}, form())).toMatchObject({ path: "/api/calendrier/feed/private-token", communityName: "Mes potes" });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith("self");
  });
  it("refuse une opération inconnue ou la limite de requêtes sans écrire", async () => {
    expect(await manageCalendarFeedAction({}, form("forged"))).toHaveProperty("error");
    mocks.rate.mockReturnValue(false);
    expect(await manageCalendarFeedAction({}, form())).toHaveProperty("error");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("refuse une communauté inaccessible sans conserver un ancien lien", async () => {
    mocks.create.mockResolvedValue(null);
    expect(await manageCalendarFeedAction({ path: "/old" }, form())).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(await manageCalendarFeedAction({ path: "/old" }, form())).not.toHaveProperty("path");
  });
  it("révoque uniquement pour la session et efface le secret affiché", async () => {
    const result = await manageCalendarFeedAction({ path: "/old" }, form("revoke"));
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("self");
    expect(result).toHaveProperty("message"); expect(result).not.toHaveProperty("path");
  });
  it("ne transforme pas une panne de persistance en succès", async () => {
    mocks.create.mockRejectedValue(new Error("database unavailable"));
    await expect(manageCalendarFeedAction({}, form())).rejects.toThrow("database unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
