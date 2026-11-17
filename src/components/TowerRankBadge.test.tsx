// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TowerRankBadge } from "./TowerRankBadge";

afterEach(cleanup);

it.each(["Irregular", "Ranker", "High Ranker"] as const)("nomme le rang %s sans dépendre de la couleur", rank => {
  render(<TowerRankBadge rank={rank} />);
  const badge = screen.getByTitle(`Rang The Tower : ${rank}`);
  expect(badge.textContent).toBe(`Rang The Tower : ${rank}`);
  expect(badge.className).toContain("text-foreground");
  expect(badge.querySelector("[aria-hidden='true']")).toBeTruthy();
});

it("porte le violet décidé du Ranker sur la pastille", () => {
  render(<TowerRankBadge rank="Ranker" />);
  const dot = screen.getByTitle("Rang The Tower : Ranker").querySelector<HTMLElement>("[aria-hidden='true']");
  expect(dot?.style.backgroundColor).toBe("rgb(139, 92, 246)");
});
