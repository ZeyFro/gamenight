import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TowerEntryPoints } from "./TowerEntryPoints";

describe("TowerEntryPoints", () => {
  it("relie les trois destinations communautaires existantes", () => {
    render(<TowerEntryPoints />);

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/equipes",
      "/sessions",
      "/tower",
    ]);
    expect(
      screen.getByRole("navigation", { name: "Espaces de la communauté" }),
    ).toBeTruthy();
  });
});
