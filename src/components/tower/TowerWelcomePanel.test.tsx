// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { towerWelcomePanel, welcomeActionUrl } from "@/lib/tower-onboarding-panel";
import { TowerWelcomePanel } from "./TowerWelcomePanel";

afterEach(cleanup);

describe("accueil The Tower", () => {
  it("présente les trois actions avec leurs destinations GameNight", () => {
    render(<TowerWelcomePanel />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Trouver des joueurs", "/tower/forums"],
      ["Rejoindre une soirée", "/sessions"],
      ["Commencer l'Ascension", "/tower"],
    ]);
  });

  it("préserve les identifiants Discord et rejette une action non déclarée", () => {
    expect(towerWelcomePanel().components[0].components.map((action) => action.custom_id)).toEqual([
      "gn:welcome:players",
      "gn:welcome:evening",
      "gn:welcome:tower",
    ]);
    expect(welcomeActionUrl("constructor")).toBeNull();
  });
});
