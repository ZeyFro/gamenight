// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WishlistProposeForm } from "./WishlistProposeForm";

vi.mock("@/app/wishlist/actions", () => ({ proposeWishlistGameAction: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pendingSearch() {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>((complete) => { resolve = complete; });
  return { response, resolve };
}

function matches(name: string, igdbId: number) {
  return Response.json({ results: [{ name, igdbId, coverUrl: null, isCoop: false }] });
}

it("garde les résultats du dernier terme si une réponse plus ancienne arrive ensuite", async () => {
  const oldSearch = pendingSearch();
  const newSearch = pendingSearch();
  const fetchIgdb = vi.fn()
    .mockReturnValueOnce(oldSearch.response)
    .mockReturnValueOnce(newSearch.response);
  vi.stubGlobal("fetch", fetchIgdb);
  render(<WishlistProposeForm />);
  const input = screen.getByPlaceholderText("Rechercher un jeu sur IGDB…");
  fireEvent.change(input, { target: { value: "Minecraft" } });
  await waitFor(() => expect(fetchIgdb).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "Palworld" } });

  await waitFor(() => expect(fetchIgdb).toHaveBeenCalledTimes(2));

  await act(async () => { newSearch.resolve(matches("Palworld", 2)); });
  expect(screen.getByRole("button", { name: "Palworld" })).toBeDefined();
  await act(async () => { oldSearch.resolve(matches("Minecraft", 1)); });
  expect(screen.queryByRole("button", { name: "Minecraft" })).toBeNull();
  expect(screen.getByRole("button", { name: "Palworld" })).toBeDefined();
});

it("ignore une réponse en cours lorsque la saisie est effacée", async () => {
  const pending = pendingSearch();
  const fetchIgdb = vi.fn().mockReturnValue(pending.response);
  vi.stubGlobal("fetch", fetchIgdb);
  render(<WishlistProposeForm />);
  const input = screen.getByPlaceholderText("Rechercher un jeu sur IGDB…");
  fireEvent.change(input, { target: { value: "Minecraft" } });
  await waitFor(() => expect(fetchIgdb).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => { pending.resolve(matches("Minecraft", 1)); });
  expect(screen.queryByRole("button", { name: "Minecraft" })).toBeNull();
  expect(screen.queryByText("Recherche…")).toBeNull();
  expect(fetchIgdb).toHaveBeenCalledTimes(1);
});

it("retire les résultats déjà affichés dès que le terme change", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(matches("Minecraft", 1)));
  render(<WishlistProposeForm />);
  const input = screen.getByPlaceholderText("Rechercher un jeu sur IGDB…");
  fireEvent.change(input, { target: { value: "Minecraft" } });
  await screen.findByRole("button", { name: "Minecraft" });
  fireEvent.change(input, { target: { value: "Palworld" } });
  expect(screen.queryByRole("button", { name: "Minecraft" })).toBeNull();
});
