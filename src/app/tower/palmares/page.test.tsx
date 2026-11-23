// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), podium: vi.fn(), progress: vi.fn(), teams: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/tower-team-standings", () => ({ getTowerTeamStandings: mocks.teams }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.community }));
vi.mock("@/lib/tower-season-podium", () => ({ getTowerSeasonPodium: mocks.podium }));
vi.mock("@/lib/tower-personal-progress", () => ({ getTowerPersonalProgress: mocks.progress }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community");
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
  mocks.progress.mockResolvedValue({ status: "DISABLED" });
  mocks.teams.mockResolvedValue({ status: "DISABLED" });
  mocks.podium.mockResolvedValue({ status: "PODIUM", season: { name: "S1 · 2026-2027", startAt: new Date("2026-11-30T23:00:00Z"), endAt: new Date("2027-03-31T22:00:00Z") }, entries: [] });
});
afterEach(cleanup);
it("affiche les dates de Paris et un état vide sans faux gagnant", async () => {
  render(await Page());
  expect(screen.getByText(/1(er)? décembre 2026/)).toBeTruthy();
  expect(screen.getByText(/31 mars 2027/)).toBeTruthy();
  expect(screen.getByText(/Aucune récompense créditée/)).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Podium de la saison terminée" })).toBeNull();
});
it("présente le podium calculé et échappe les noms des membres", async () => {
  mocks.podium.mockResolvedValueOnce({ status: "PODIUM", season: { name: "S1 · 2026-2027", startAt: new Date("2026-11-30T23:00:00Z"), endAt: new Date("2027-03-31T22:00:00Z") }, entries: [{ rank: 1, displayName: "<img src=x>", rewardFloors: "6", difficultWins: "2" }] });
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
  expect(mocks.progress).not.toHaveBeenCalled();
});
it("ne lit aucune communauté de repli si aucune n'est sélectionnée", async () => {
  mocks.community.mockResolvedValueOnce(null);
  render(await Page());
  expect(screen.getByText(/n’est pas disponible/)).toBeTruthy();
  expect(mocks.podium).not.toHaveBeenCalled();
  expect(mocks.progress).not.toHaveBeenCalled();
});
const season = { name: "S1 · 2026-2027", startAt: new Date("2026-11-30T23:00:00Z"), endAt: new Date("2027-03-31T22:00:00Z") };
it("affiche les co-lauréats à la même place avec la mention ex æquo, sans en écarter un seul", async () => {
  mocks.podium.mockResolvedValueOnce({ status: "PODIUM", season, entries: [
    { rank: 1, exAequo: true, displayName: "Alpha", rewardFloors: "6", difficultWins: "2" },
    { rank: 1, exAequo: true, displayName: "Bravo", rewardFloors: "6", difficultWins: "2" },
    { rank: 3, exAequo: false, displayName: "Charlie", rewardFloors: "4", difficultWins: "1" },
  ] });
  render(await Page());
  const headings = screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent?.replace(/\s+/g, " ").trim());
  expect(headings).toEqual(["🥇 1. Alpha (ex æquo)", "🥇 1. Bravo (ex æquo)", "🥉 3. Charlie"]);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});
it("montre la progression du lecteur : étages gagnés, rang, saisons terminées et prochaine marche", async () => {
  mocks.progress.mockResolvedValueOnce({ status: "PROGRESS", floorsClimbed: "42", completedSeasons: 0, seasonChallenges: 2, rank: "Ranker", next: { rank: "High Ranker", floorsMissing: "58", challengesMissing: 3 } });
  render(await Page());
  expect(mocks.progress).toHaveBeenCalledWith({ viewerId: "viewer", memberId: "viewer", communityId: "community" });
  expect(screen.getByRole("heading", { name: "Ta progression" })).toBeTruthy();
  expect(screen.getByText(/42 étage\(s\) gagné\(s\) avec les défis · 2 défi\(s\) validé\(s\) cette saison/)).toBeTruthy();
  expect(screen.getByTitle("Rang The Tower : Ranker")).toBeTruthy();
  expect(screen.getByText("Prochain rang, High Ranker : encore 58 étage(s) à gagner et 3 défi(s) validé(s) sur la saison en cours.")).toBeTruthy();
  expect(screen.getByText(/jamais de l’XP/)).toBeTruthy();
});
it.each([
  [{ rank: "Ranker", floorsMissing: "3", challengesMissing: 0 }, "Prochain rang, Ranker : encore 3 étage(s) à gagner."],
  [{ rank: "High Ranker", floorsMissing: "0", challengesMissing: 2 }, "Prochain rang, High Ranker : encore 2 défi(s) validé(s) sur la saison en cours."],
  [null, "Tu as atteint le rang le plus élevé."],
])("explique la prochaine marche %o", async (next, text) => {
  mocks.progress.mockResolvedValueOnce({ status: "PROGRESS", floorsClimbed: "100", completedSeasons: 1, seasonChallenges: 5, rank: "High Ranker", next });
  render(await Page());
  expect(screen.getByText(text)).toBeTruthy();
});
it("ne propose la page d'administration du palmarès qu'aux administrateurs de la communauté", async () => {
  render(await Page());
  expect(screen.queryByRole("link", { name: /Proposition de palmarès/ })).toBeNull();
  cleanup();
  mocks.podium.mockResolvedValueOnce({ status: "PODIUM", season, canReview: true, entries: [] });
  render(await Page());
  expect(screen.getByRole("link", { name: "Proposition de palmarès (administration)" }).getAttribute("href")).toBe("/admin/tower-palmares");
});
it("n'affiche aucune progression quand la Tour est éteinte ou indisponible", async () => {
  for (const status of ["DISABLED", "UNAVAILABLE", "INVALID"]) {
    mocks.progress.mockResolvedValueOnce({ status });
    render(await Page());
    expect(screen.queryByRole("heading", { name: "Ta progression" })).toBeNull();
    cleanup();
  }
});

it("classement des équipes : saison et depuis toujours, ex æquo signalé, emblème affiché", async () => {
  const team = (teamId: string, name: string, rank: number, exAequo = false) => ({ teamId, name, color: "#ff0000", emblem: "🐉", floors: 6, wins: 2, reachedAt: new Date(), rank, exAequo });
  mocks.teams.mockResolvedValueOnce({ status: "STANDINGS", season: { name: "S1 · 2026-2027" }, seasonTeams: [team("a", "Les Dragons", 1, true), team("b", "Les Loups", 1, true)], allTimeTeams: [] });
  render(await Page());
  expect(screen.getByRole("heading", { name: "Classement des équipes" })).toBeTruthy();
  const season = screen.getByRole("region", { name: "Classement des équipes : S1 · 2026-2027" });
  expect(season.textContent).toContain("1. 🐉Les Dragons (ex æquo)");
  expect(season.textContent).toContain("6 étage(s) · 2 défi(s)");
  expect(screen.getByRole("region", { name: "Classement des équipes : Depuis toujours" }).textContent).toContain("Aucun défi d’équipe validé.");
});
