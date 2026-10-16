// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ price: vi.fn(), update: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/game-purchase", () => ({ getSteamPurchaseInfo: mocks.price }));
vi.mock("@/app/jeux/preparation-actions", () => ({ updateGamePreparation: mocks.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { GamePreparation, GameSteamPrice } from "./GamePreparation";
import { GamePreparationForm } from "./GamePreparationForm";
const unknown = { preparationCost:null,preparationPrice:null,downloadSizeGb:null,preparationPlatform:null,preparationSourceUrl:null,preparationUpdatedAt:null };
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ok:true}); });
afterEach(cleanup);
describe("coût et téléchargement sur la fiche", () => {
  it("conserve le jour de la déclaration murale près de minuit", () => {
    render(<GamePreparation game={{ ...unknown, preparationUpdatedAt: new Date("2026-10-16T23:30:00Z") }} />);
    expect(screen.getByText(/16\/10\/2026/)).toBeTruthy();
  });
  it("affiche inconnu puis un relevé sourcé avec plateforme, volume et date", () => {
    const {rerender}=render(<GamePreparation game={unknown} />); expect(screen.getAllByText("Non renseigné")).toHaveLength(2); expect(screen.queryByText("Gratuit")).toBeNull();
    rerender(<GamePreparation game={{...unknown,preparationCost:"PAID",preparationPrice:"12 EUR",downloadSizeGb:12.5,preparationPlatform:"Windows / Steam",preparationSourceUrl:"https://example.com/game",preparationUpdatedAt:new Date("2026-10-15T12:00:00Z")}} />);
    expect(screen.getByText("Payant · 12 EUR")).toBeTruthy(); expect(screen.getByText("12,5 Go")).toBeTruthy(); expect(screen.getByText("Windows / Steam")).toBeTruthy(); expect(screen.getByText(/15\/10\/2026/)).toBeTruthy(); expect(screen.getByRole("link",{name:"Consulter la source du relevé"}).getAttribute("href")).toBe("https://example.com/game");
  });
  it("ne transforme ni une panne ni un prix absent en gratuité", async () => {
    mocks.price.mockResolvedValue(null); const {rerender}=render(await GameSteamPrice({appId:620})); expect(screen.getByText(/indisponibles/)).toBeTruthy(); expect(screen.queryByText("Gratuit")).toBeNull();
    mocks.price.mockResolvedValue({isFree:false,priceFormatted:null,currency:null,observedAt:"2026-10-15T12:00:00Z"}); rerender(await GameSteamPrice({appId:620})); expect(screen.getByText("Payant")).toBeTruthy(); expect(screen.getByText(/Prix affiché : non disponible/)).toBeTruthy();
    mocks.price.mockResolvedValue({isFree:true,priceFormatted:null,currency:null,observedAt:"2026-10-15T12:00:00Z"}); rerender(await GameSteamPrice({appId:620})); expect(screen.getByText("Gratuit")).toBeTruthy(); expect(screen.queryByText(/Prix affiché/)).toBeNull();
  });
  it("indique région, devise et date du relevé Steam", async () => {
    mocks.price.mockResolvedValue({isFree:false,priceFormatted:"12€",currency:"EUR",observedAt:"2026-10-15T12:00:00Z"}); render(await GameSteamPrice({appId:620}));
    expect(screen.getByText("Boutique Steam · France")).toBeTruthy(); expect(screen.getByText(/12€ \(EUR\)/)).toBeTruthy(); expect(screen.getByText(/15\/10\/2026/)).toBeTruthy(); expect(screen.getByRole("link",{name:"Voir la fiche Steam"}).getAttribute("href")).toBe("https://store.steampowered.com/app/620/?cc=fr");
  });
  it("préremplit le formulaire, envoie un effacement puis actualise après succès", async () => {
    render(<GamePreparationForm game={{...unknown,id:"g",preparationCost:"PAID",preparationPrice:"12 EUR",downloadSizeGb:12.5,preparationPlatform:"Windows",preparationSourceUrl:"https://example.com"}} />);
    fireEvent.click(screen.getByText("Renseigner le coût et le téléchargement"));
    expect((screen.getByLabelText("Téléchargement estimé (Go)") as HTMLInputElement).value).toBe("12.5");
    fireEvent.change(screen.getByLabelText("Coût déclaré"),{target:{value:"unknown"}});
    for(const name of ["Prix et devise (si payant)","Téléchargement estimé (Go)","Plateforme / version","Source du relevé (HTTPS)"]) fireEvent.change(screen.getByLabelText(name),{target:{value:""}});
    fireEvent.submit(screen.getByRole("button",{name:"Enregistrer le relevé"}).closest("form")!);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(Object.fromEntries(mocks.update.mock.calls[0][0])).toEqual({gameId:"g",preparationCost:"unknown",preparationPrice:"",preparationPlatform:"",preparationSourceUrl:"",downloadSizeGb:""}); expect(screen.getByRole("status").textContent).toContain("enregistré");
  });
  it("affiche les échecs serveur et réseau sans annoncer un succès", async () => {
    render(<GamePreparationForm game={{...unknown,id:"g"}} />); fireEvent.click(screen.getByText("Renseigner le coût et le téléchargement"));
    const form=screen.getByRole("button",{name:"Enregistrer le relevé"}).closest("form")!;
    mocks.update.mockResolvedValue({ok:false,error:"invalid"}); fireEvent.submit(form); await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("HTTPS"));
    mocks.update.mockRejectedValue(Error("network")); fireEvent.submit(form); await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Enregistrement impossible")); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
