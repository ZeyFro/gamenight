// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), proposal: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.community }));
vi.mock("@/lib/tower-season-proposal", () => ({ getTowerSeasonProposal: mocks.proposal }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
import Page from "./page";

const S2 = { name: "S2 · 2027", startAt: new Date("2027-03-31T22:00:00.000Z"), endAt: new Date("2027-06-30T22:00:00.000Z") };
const S1 = { name: "S1 · 2027", startAt: new Date("2027-01-03T23:00:00.000Z"), endAt: new Date("2027-03-28T22:00:00.000Z") };
const base = {
  status: "PROPOSAL", communityName: "The Tower", computedAt: new Date("2027-07-10T12:00:00Z"), seasons: [S2, S1], season: S2,
  completed: true, creditedFloors: "9", creditedPlayers: 4, truncated: false, candidates: [], formerMembers: [],
};
const open = (saison?: string | string[]) => Page({ searchParams: Promise.resolve(saison === undefined ? {} : { saison }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "admin" });
  mocks.community.mockResolvedValue("community");
  mocks.proposal.mockResolvedValue(base);
});
afterEach(cleanup);

describe("proposition de palmarès (page d'administration)", () => {
  it("renvoie un visiteur à l'accueil sans rien lire", async () => {
    mocks.user.mockResolvedValueOnce(null);
    await expect(open()).rejects.toThrow("REDIRECT:/");
    expect(mocks.community).not.toHaveBeenCalled();
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it("sans communauté active, n'interroge aucune proposition", async () => {
    mocks.community.mockResolvedValueOnce(null);
    render(await open());
    expect(screen.getByText(/Choisis une communauté active/)).toBeTruthy();
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "INVALID", "UNKNOWN_SEASON"])("statut %s : page introuvable, sans indice sur la raison", async status => {
    mocks.proposal.mockResolvedValueOnce({ status });
    await expect(open()).rejects.toThrow("NOT_FOUND");
  });

  it.each(["UNAVAILABLE", "DISABLED"])("statut %s : message d'indisponibilité, aucun classement", async status => {
    mocks.proposal.mockResolvedValueOnce({ status });
    render(await open());
    expect(screen.getByText(/n’est pas disponible/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("demande la saison choisie dans l'adresse, et la dernière saison finie par défaut", async () => {
    render(await open());
    expect(mocks.proposal).toHaveBeenLastCalledWith({ userId: "admin", communityId: "community" });
    cleanup();
    render(await open("2027-01-03T23:00:00.000Z"));
    expect(mocks.proposal).toHaveBeenLastCalledWith({ userId: "admin", communityId: "community", seasonStart: "2027-01-03T23:00:00.000Z" });
    cleanup();
    // Paramètre répété ou vide : ignoré plutôt que transmis tel quel.
    render(await open(["a", "b"]));
    expect(mocks.proposal).toHaveBeenLastCalledWith({ userId: "admin", communityId: "community" });
    render(await open(""));
    expect(mocks.proposal).toHaveBeenLastCalledWith({ userId: "admin", communityId: "community" });
  });

  it("liste les saisons finies, marque la saison ouverte et pointe chaque lien sur le début de sa saison", async () => {
    render(await open());
    const links = within(screen.getByRole("navigation", { name: "Saisons terminées" })).getAllByRole("link");
    expect(links.map(link => [link.textContent, link.getAttribute("aria-current"), link.getAttribute("href")])).toEqual([
      ["S2 · 2027", "page", "/admin/tower-palmares?saison=2027-03-31T22%3A00%3A00.000Z"],
      ["S1 · 2027", null, "/admin/tower-palmares?saison=2027-01-03T23%3A00%3A00.000Z"],
    ]);
  });

  it("annonce une lecture seule et les dates de Paris de la saison (fin incluse la veille de la borne exclusive)", async () => {
    render(await open());
    expect(screen.getByText(/ne publie rien, n’attribue aucun titre ni badge et n’enregistre rien/)).toBeTruthy();
    expect(screen.getByText(/Du 1 avril 2027 au 30 juin 2027 inclus/)).toBeTruthy();
    expect(screen.getByText(/9 étage\(s\) crédité\(s\) à 4 joueur\(s\)/)).toBeTruthy();
    expect(screen.getByText(/Calculé le 10 juil\. 2027/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
  });

  it("présente les co-lauréats à la même place, signale le podium et n'interprète pas les noms comme du HTML", async () => {
    mocks.proposal.mockResolvedValueOnce({ ...base, candidates: [
      { place: 1, exAequo: true, onPodium: true, displayName: "<img src=x>", rewardFloors: "6", difficultWins: "2", reachedAt: new Date("2027-05-01T10:00:00Z") },
      { place: 1, exAequo: true, onPodium: true, displayName: "Bravo", rewardFloors: "6", difficultWins: "2", reachedAt: new Date("2027-05-01T10:00:00Z") },
      { place: 3, exAequo: false, onPodium: true, displayName: "Charlie", rewardFloors: "4", difficultWins: "1", reachedAt: new Date("2027-05-02T10:00:00Z") },
      { place: 4, exAequo: false, onPodium: false, displayName: "Delta", rewardFloors: "1", difficultWins: "0", reachedAt: new Date("2027-05-03T10:00:00Z") },
    ] });
    const { container } = render(await open());
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map(row => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1 ex æquo · podium", "1 ex æquo · podium", "3 · podium", "4"]);
    expect(rows.map(row => within(row).getByRole("rowheader").textContent)).toEqual(["<img src=x>", "Bravo", "Charlie", "Delta"]);
    expect(within(rows[2]).getAllByRole("cell").slice(1, 3).map(cell => cell.textContent)).toEqual(["4", "1"]);
    expect(within(rows[0]).getAllByRole("cell")[3].textContent).toMatch(/1 mai 2027.*12:00:00/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("liste à part les joueurs crédités qui ne sont plus membres actifs, avec leur situation", async () => {
    mocks.proposal.mockResolvedValueOnce({ ...base, formerMembers: [
      { displayName: "Parti", rewardFloors: "3", difficultWins: "1", reachedAt: new Date("2027-05-01T10:00:00Z"), membershipStatus: "LEFT" },
      { displayName: "Retiré", rewardFloors: "2", difficultWins: "0", reachedAt: new Date("2027-05-02T10:00:00Z"), membershipStatus: "REMOVED" },
      { displayName: "Fantôme", rewardFloors: "1", difficultWins: "0", reachedAt: new Date("2027-05-03T10:00:00Z"), membershipStatus: null },
    ] });
    render(await open());
    expect(screen.getByRole("heading", { name: "Crédités, mais plus membres actifs" })).toBeTruthy();
    const items = screen.getAllByRole("listitem").map(item => item.textContent).filter(text => /étage\(s\)/.test(text ?? ""));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/^Parti · 3 étage\(s\) · 1 défi\(s\) à 3 étages.*\(a quitté le serveur\)$/);
    expect(items[1]).toMatch(/^Retiré .*\(retiré du serveur\)$/);
    expect(items[2]).toMatch(/^Fantôme .*\(n’est plus membre\)$/);
    expect(screen.getByText(/Aucun membre encore actif n’a été crédité/)).toBeTruthy();
  });

  it("saison sans étage crédité : pas de palmarès, ni tableau ni liste d'anciens membres", async () => {
    mocks.proposal.mockResolvedValueOnce({ ...base, completed: false, creditedFloors: "0", creditedPlayers: 0 });
    render(await open());
    expect(screen.getByText(/ne compte pas comme terminée et n’a pas de palmarès/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/Aucun membre encore actif/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Crédités, mais plus membres actifs" })).toBeNull();
  });

  it("prévient quand le classement est tronqué au lieu de le présenter comme complet", async () => {
    render(await open());
    expect(screen.queryByText(/incomplète/)).toBeNull();
    cleanup();
    mocks.proposal.mockResolvedValueOnce({ ...base, truncated: true });
    render(await open());
    expect(screen.getByText(/incomplète et ne doit pas être utilisée telle quelle/)).toBeTruthy();
  });
});
