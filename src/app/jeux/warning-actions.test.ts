import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), rate: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
import { updateGameWarnings } from "./warning-actions";
function form() { const f = new FormData(); for (const [key,value] of Object.entries({ gameId: "g", jumpscares: "present", motionSickness: "absent", textLanguages: " français ", audioLanguages: "", userId: "forged", isCoop: "true" })) f.set(key,value); return f; }
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(true); mocks.update.mockResolvedValue({ count: 1 }); });
describe("édition des avertissements", () => {
  it("exige une connexion puis applique le rate limit avant écriture", async () => {
    mocks.current.mockResolvedValue(null); await expect(updateGameWarnings(form())).rejects.toThrow("REDIRECT:/"); expect(mocks.update).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(false);
    expect(await updateGameWarnings(form())).toEqual({ ok: false, error: "rate_limited" }); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejette les valeurs inconnues, manquantes, binaires et trop longues sans écriture partielle", async () => {
    for (const [key,value] of [["jumpscares","false"], ["motionSickness",""], ["textLanguages","a".repeat(121)], ["gameId",""]]) { const f = form(); f.set(key,value); expect(await updateGameWarnings(f)).toEqual({ ok: false, error: "invalid" }); }
    const f = form(); f.delete("audioLanguages"); expect((await updateGameWarnings(f)).ok).toBe(false);
    f.set("audioLanguages",new Blob(["x"])); expect((await updateGameWarnings(f)).ok).toBe(false); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("filtre atomiquement le possesseur, ignore une identité forgée et normalise les langues", async () => {
    expect(await updateGameWarnings(form())).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "g", userGames: { some: { userId: "self", owned: true } } }, data: { jumpscares: true, motionSickness: false, textLanguages: "français", audioLanguages: null, warningsUpdatedAt: expect.any(Date) } });
    expect(mocks.revalidate).toHaveBeenCalledWith("/sessions","layout"); expect(mocks.revalidate).toHaveBeenCalledWith("/jouer-maintenant","layout");
  });
  it("permet de rétablir l'inconnu et ne prétend pas réussir si la possession a disparu", async () => {
    const f = form(); f.set("jumpscares","unknown"); f.set("motionSickness","unknown"); f.set("textLanguages", " "); await updateGameWarnings(f);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ jumpscares: null, motionSickness: null, textLanguages: null });
    mocks.revalidate.mockClear(); mocks.update.mockResolvedValue({ count: 0 }); expect(await updateGameWarnings(f)).toEqual({ ok: false, error: "access" }); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("propage une erreur de base sans message de réussite", async () => {
    mocks.update.mockRejectedValue(Error("db unavailable")); await expect(updateGameWarnings(form())).rejects.toThrow("db unavailable"); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
