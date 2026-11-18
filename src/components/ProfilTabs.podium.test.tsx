// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/profil" }));
import { ProfilTabs } from "./ProfilTabs";
afterEach(cleanup);
it("rend le palmarès Tower accessible depuis le profil", () => {
  render(<ProfilTabs />);
  expect(screen.getByRole("link", { name: "Palmarès Tower" }).getAttribute("href")).toBe("/tower/palmares");
});
