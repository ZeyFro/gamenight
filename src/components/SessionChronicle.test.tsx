// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/app/sessions/actions/chronicles", () => ({ saveSessionChronicleAction: vi.fn() }));
import { SessionChronicle } from "./SessionChronicle";
afterEach(cleanup);

it("réserve le champ d'édition au créateur", () => {
  render(<SessionChronicle sessionId="s1" text="Beau clutch" canEdit={false} />);
  expect(screen.getByText("Beau clutch")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("affiche un texte brut et un champ étiqueté et borné", () => {
  const { container } = render(<SessionChronicle sessionId="s1" text={'<script>alert(1)</script>'} canEdit />);
  expect(container.querySelector("script")).toBeNull();
  const field = screen.getByRole("textbox", { name: /Le souvenir/ }) as HTMLTextAreaElement;
  expect(field.maxLength).toBe(10000);
  expect(field.defaultValue).toContain("<script>");
});
