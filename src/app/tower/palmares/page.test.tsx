// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), podium: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.community }));
vi.mock("@/lib/tower-season-podium", () => ({ getTowerSeasonPodium: mocks.podium }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community");
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
  mocks.podium.mockResolvedValue({ status: "PODIUM", season: { name: "S1 · 2027", startAt: new Date("2027-01-03T23:00:00Z"), endAt: new Date("2027-03-28T22:00:00Z") }, entries: [] });
});
afterEach(cleanup);
it("affiche les dates de Paris et un état vide sans faux gagnant", async () => {
  render(await Page());
  expect(screen.getByText(/4 janvier 2027/)).toBeTruthy();
  expect(screen.getByText(/28 mars 2027/)).toBeTruthy();
  expect(screen.getByText(/Aucune récompense créditée/)).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Podium de la saison terminée" })).toBeNull();
});
it("présente le podium calculé et échappe les noms des membres", async () => {
  mocks.podium.mockResolvedValueOnce({ status: "PODIUM", season: { name: "S1 · 2027", startAt: new Date("2027-01-03T23:00:00Z"), endAt: new Date("2027-03-28T22:00:00Z") }, entries: [{ rank: 1, displayName: "<img src=x>", rewardFloors: "6", difficultWins: "2" }] });
  const { container } = render(await Page());
  expect(screen.getByRole("list", { name: "Podium de la saison terminée" })).toBeTruthy();
  expect(screen.getByText(/6 étage/)).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByRole("heading", { name: /<img src=x>/ })).toBeTruthy();
});
it("redirige un visiteur sans lire le palmarès", async () => {
  mocks.user.mockResolvedValueOnce(null);
  await expect(Page()).rejects.toThrow("REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/");
  expect(mocks.podium).not.toHaveBeenCalled();
});
it("ne lit aucune communauté de repli si aucune n'est sélectionnée", async () => {
  mocks.community.mockResolvedValueOnce(null);
  render(await Page());
  expect(screen.getByText(/n’est pas disponible/)).toBeTruthy();
  expect(mocks.podium).not.toHaveBeenCalled();
});
