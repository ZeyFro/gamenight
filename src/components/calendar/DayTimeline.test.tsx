// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayTimeline } from "./DayTimeline";

const { push, upsertOverride } = vi.hoisted(() => ({ push: vi.fn(), upsertOverride: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/disponibilites/actions", () => ({ upsertOverride, removeOverrideForDate: vi.fn() }));
vi.mock("@/components/ui/Button", () => ({ ButtonLink: ({ href, children, ...props }: React.ComponentProps<"a"> & { variant?: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/calendar/SessionBlock", () => ({ SessionBlock: () => <div>Soirée existante</div> }));

const date = new Date("2026-11-01T00:00:00Z");
const users = ["a", "b"].map((id) => ({ id, discordName: `Pote ${id}`, discordAvatar: null, color: "#aabbcc" }));
const props = {
  day: { date, sessions: [], hours: [{ hour: 20, availableUserIds: ["a", "b"] }], maxAvailableCount: 2 },
  users, mode: "collectif" as const, date, today: date, canEdit: true, ownWeeklySlots: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  upsertOverride.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("calendrier tactile : créer au créneau choisi", () => {
  it("le créneau avec plusieurs potes permet aussi de créer sans remonter la page", () => {
    render(<DayTimeline {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /20h — 2 potes dispo/ }));
    expect(screen.getByText("Pote a", { selector: "li" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Créer une soirée à 20h00" }).getAttribute("href"))
      .toBe("/sessions?date=2026-11-01&time=20:00#nouvelle-soiree");
    expect(upsertOverride).not.toHaveBeenCalled();
  });
  it("un créneau vide ouvre la création avec sa date et son heure", () => {
    render(<DayTimeline {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "21h — créer une soirée à cette heure" }));
    expect(screen.getByRole("link", { name: "Créer" }).getAttribute("href"))
      .toBe("/sessions?date=2026-11-01&time=21:00#nouvelle-soiree");
    expect(upsertOverride).not.toHaveBeenCalled();
  });
  it("modifier ses dispos reste un geste distinct de créer", () => {
    render(<DayTimeline {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Modifier mes dispos/ }));
    fireEvent.click(screen.getByRole("button", { name: /20h — pas dispo, taper pour ajouter/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /20h — début de plage sélectionné/ })).toBeTruthy();
    expect(upsertOverride).not.toHaveBeenCalled();
  });
  it("un scroll vertical tactile ne change pas de jour", () => {
    render(<DayTimeline {...props} />);
    const timeline = screen.getByRole("button", { name: /21h — créer/ }).closest("div.rounded-xl")!;
    fireEvent.touchStart(timeline, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(timeline, { changedTouches: [{ clientX: 110, clientY: 400 }] });
    expect(push).not.toHaveBeenCalled();
  });
});
