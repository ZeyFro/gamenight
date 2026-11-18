// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TowerRankBadge } from "./TowerRankBadge";

afterEach(cleanup);

it.each(["Régulars", "Irregular", "Ranker", "High Ranker"] as const)("nomme le rang %s sans dépendre de la couleur", rank => {
  render(<TowerRankBadge rank={rank} />);
  const badge = screen.getByTitle(`Rang The Tower : ${rank}`);
  expect(badge.textContent).toBe(`Rang The Tower : ${rank}`);
  expect(badge.className).toContain("text-foreground");
  expect(badge.querySelector("[aria-hidden='true']")).toBeTruthy();
});

it.each([["Régulars", "rgb(107, 114, 128)"], ["Irregular", "rgb(139, 92, 246)"], ["Ranker", "rgb(245, 158, 11)"], ["High Ranker", "rgb(220, 38, 38)"]] as const)("porte la couleur décidée du grade %s sur la pastille", (rank, color) => {
  render(<TowerRankBadge rank={rank} />);
  const dot = screen.getByTitle(`Rang The Tower : ${rank}`).querySelector<HTMLElement>("[aria-hidden='true']");
  expect(dot?.style.backgroundColor).toBe(color);
});
