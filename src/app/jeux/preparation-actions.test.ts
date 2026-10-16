import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), rate: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
import { updateGamePreparation } from "./preparation-actions";
function form() { const f = new FormData(); for (const [k,v] of Object.entries({ gameId: "g", preparationCost: "PAID", preparationPrice: " 12 EUR ", downloadSizeGb: "12,50", preparationPlatform: "PC Windows", preparationSourceUrl: "https://store.example/game", userId: "forged", minPlayers: "99" })) f.set(k,v); return f; }
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(true); mocks.update.mockResolvedValue({ count: 1 }); });
describe("relevé déclaré de préparation", () => {
  it.each([["0,01", 0.01], ["5000", 5000]])("accepte le volume autorisé à la borne %s Go", async (raw, expected) => {
    const f = form(); f.set("downloadSizeGb", String(raw));
    expect(await updateGamePreparation(f)).toEqual({ ok: true });
    expect(mocks.update.mock.calls[0][0].data.downloadSizeGb).toBe(expected);
  });
  it("exige connexion et rate limit avant écriture", async () => {
    mocks.current.mockResolvedValue(null); await expect(updateGamePreparation(form())).rejects.toThrow("REDIRECT:/"); expect(mocks.update).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue({id:"self"}); mocks.rate.mockReturnValue(false); expect(await updateGamePreparation(form())).toEqual({ok:false,error:"rate_limited"}); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("exige source/plateforme et cohérence du prix, borne URL, textes et volume", async () => {
    for (const [key,value] of [["preparationSourceUrl",""],["preparationPlatform",""],["preparationSourceUrl","javascript:alert(1)"],["preparationSourceUrl","https://user:secret@example.com"],["downloadSizeGb","0"],["downloadSizeGb","-1"],["downloadSizeGb","Infinity"],["downloadSizeGb","5001"],["downloadSizeGb","0.001"],["preparationCost","FREE"],["preparationCost","unknown"],["preparationPrice","x".repeat(121)],["preparationPlatform","x".repeat(81)]]) {
      const f=form(); f.set(key,value); expect(await updateGamePreparation(f)).toEqual({ok:false,error:"invalid"});
    }
    const f=form(); f.set("downloadSizeGb",new Blob(["1"])); expect((await updateGamePreparation(f)).ok).toBe(false); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("écrit seulement les champs validés avec une possession atomiquement revalidée", async () => {
    expect(await updateGamePreparation(form())).toEqual({ok:true});
    expect(mocks.update).toHaveBeenCalledWith({where:{id:"g",userGames:{some:{userId:"self",owned:true}}},data:{preparationCost:"PAID",preparationPrice:"12 EUR",downloadSizeGb:12.5,preparationPlatform:"PC Windows",preparationSourceUrl:"https://store.example/game",preparationUpdatedAt:expect.any(Date)}});
  });
  it("permet l'effacement total et distingue possession perdue et panne", async () => {
    const f=form(); for(const k of ["preparationPrice","downloadSizeGb","preparationPlatform","preparationSourceUrl"]) f.set(k,""); f.set("preparationCost","unknown");
    expect(await updateGamePreparation(f)).toEqual({ok:true}); expect(mocks.update.mock.calls[0][0].data).toMatchObject({preparationCost:null,preparationPrice:null,downloadSizeGb:null,preparationPlatform:null,preparationSourceUrl:null});
    mocks.update.mockResolvedValue({count:0}); expect(await updateGamePreparation(f)).toEqual({ok:false,error:"access"});
    mocks.update.mockRejectedValue(Error("db unavailable")); await expect(updateGamePreparation(f)).rejects.toThrow("db unavailable");
  });
});
