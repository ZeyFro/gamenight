// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: "viewer" }) }));
vi.mock("@/lib/game-library", () => ({
  getGroupLibraryGames: async () => [],
  getGroupLibraryMembers: async () => [{ id: "alice", discordName: "Alice" }, { id: "bob", discordName: "Bob" }],
  getGameOwnerCounts: async () => new Map(),
  getTotalUserCount: async () => 2,
  toFilterableGame: vi.fn(),
}));
vi.mock("@/components/LibraryTabs", () => ({ LibraryTabs: () => null }));
vi.mock("@/components/GameFilterDrawer", () => ({ GameFilterDrawer: () => null }));
vi.mock("@/components/ReadOnlyGameGrid", () => ({ ReadOnlyGameGrid: ({ emptyMessage }: { emptyMessage: string }) => <p>{emptyMessage}</p> }));

import GroupLibraryPage from "./page";
afterEach(cleanup);

describe("sélection des participants de la bibliothèque", () => {
  it("soumet les personnes cochées sans perdre les autres filtres et les efface séparément", async () => {
    render(await GroupLibraryPage({ searchParams: Promise.resolve({ participants: ["alice", "bob"], modes: "coop", genres: ["RPG", "Action"] }) }));
    const form = screen.getByRole("button", { name: "Afficher les jeux communs" }).closest("form")!;
    const values = new FormData(form);
    expect(values.getAll("participants")).toEqual(["alice", "bob"]);
    expect(values.getAll("genres")).toEqual(["RPG", "Action"]);
    expect(values.get("modes")).toBe("coop");
    expect(form.method).toBe("get");
    const reset = new URL(screen.getByRole("link", { name: "Effacer la sélection" }).getAttribute("href")!, "http://localhost");
    expect(reset.searchParams.has("participants")).toBe(false);
    expect(reset.searchParams.getAll("genres")).toEqual(["RPG", "Action"]);
    expect(reset.searchParams.get("modes")).toBe("coop");
  });

  it("signale toute sélection devenue inaccessible sans afficher son identité", async () => {
    render(await GroupLibraryPage({ searchParams: Promise.resolve({ participants: ["alice", "private-id"] }) }));
    expect(screen.getByRole("alert").textContent).toContain("personne inaccessible");
    expect(document.body.textContent).not.toContain("private-id");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect((screen.getByRole("checkbox", { name: "Alice" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Bob" }) as HTMLInputElement).checked).toBe(false);
  });
});
