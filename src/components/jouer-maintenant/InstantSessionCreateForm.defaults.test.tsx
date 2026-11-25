// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/CreationForm", () => ({
  CreationForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
}));
vi.mock("@/components/tournois/TournamentGameField", () => ({
  TournamentGameField: () => null,
}));
vi.mock("@/app/jouer-maintenant/actions", () => ({
  createInstantSessionAction: vi.fn(),
}));

import { InstantSessionCreateForm } from "./InstantSessionCreateForm";

afterEach(cleanup);

const potes = ["Ana", "Bob"].map((name, index) => ({
  id: `u${index}`,
  discordName: name,
  discordAvatar: null,
  color: "#ffffff",
  tagIds: [],
}));

it("ne prévient personne par défaut pour éviter les MP en masse", () => {
  render(<InstantSessionCreateForm localGames={[]} potes={potes} />);

  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes).toHaveLength(2);
  expect(boxes.every((box) => !box.checked)).toBe(true);
  expect(screen.getByText(/Personne n’est prévenu tant que tu ne coches pas des potes/)).toBeTruthy();
});
