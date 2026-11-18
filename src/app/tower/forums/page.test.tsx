// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TowerForumsPage from "./page";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), search: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: calls.getUser }));
vi.mock("@/lib/tower-forums", () => ({ searchTowerForums: calls.search, TOWER_FORUM_QUERY_MAX: 80 }));
vi.mock("next/navigation", () => ({ redirect: calls.redirect }));

beforeEach(() => {
  vi.resetAllMocks();
  calls.getUser.mockResolvedValue({ id: "user-1", discordId: "discord-1" });
  calls.redirect.mockImplementation(() => { throw new Error("connexion requise"); });
});
afterEach(cleanup);

function page(q?: string | string[]) {
  return TowerForumsPage({ searchParams: Promise.resolve({ q }) });
}

describe("page des forums", () => {
  it("ne recherche pas sans connexion ou avec une requête ambiguë", async () => {
    calls.getUser.mockResolvedValueOnce(null);
    await expect(page("Hades")).rejects.toThrow("connexion requise");
    expect(calls.redirect).toHaveBeenCalledWith("/");
    render(await page(["Hades", "Celeste"]));
    expect(screen.getByRole("searchbox")).toBeTruthy();
    expect(calls.search).not.toHaveBeenCalled();
  });

  it("affiche les titres et les tags sans insérer de HTML Discord", async () => {
    const url = "https://discord.com/channels/111111111111111111/222222222222222222";
    calls.search.mockResolvedValue({ status: "ready", forums: [{
      id: "players", label: "Recherche de joueurs", suggestedTags: ["PC"],
      posts: [{ title: "Hades <script>", url, tags: ["PC"] }],
    }] });
    render(await page(" Hades "));
    expect(calls.search).toHaveBeenCalledWith({ id: "user-1", discordId: "discord-1" }, "Hades");
    expect(screen.getByRole("link", { name: "Hades <script>" }).getAttribute("href")).toBe(url);
  });
});
