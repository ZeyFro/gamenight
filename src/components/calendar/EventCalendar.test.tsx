// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { addDays } from "@/lib/calendar-dates";
import { EventCalendar } from "./EventCalendar";

vi.mock("@/components/ui/Button", () => ({ ButtonLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/app/calendrier/actions", () => ({ deleteCommunityDateAction: vi.fn() }));
afterEach(cleanup);
const selectedDate = new Date("2026-10-08T00:00:00Z");
const days = Array.from({ length: 35 }, (_, index) => ({ date: addDays(new Date("2026-09-28T00:00:00Z"), index), hours: [], sessions: [], communityDates: [], maxAvailableCount: 0 }));

describe("calendrier approuvé : mois, semaine, agenda", () => {
  it("affiche les dates du serveur dans le calendrier et permet à leur propriétaire de les retirer", () => {
    const data = days.map((day) => day.date.toISOString() === selectedDate.toISOString()
      ? { ...day, communityDates: [{ id: "birthday", title: "Anniversaire · Pote", kind: "BIRTHDAY" as const, date: selectedDate, createdById: "me" }] }
      : day);
    render(<EventCalendar days={data} selectedDate={selectedDate} today={selectedDate} mode="collectif" view="mois" totalUsers={2} viewerId="me" canManageCommunityDates={false} />);
    expect(screen.getAllByText("Anniversaire · Pote").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retirer du calendrier" })).toBeTruthy();
  });

  it("conserve les filtres et la date quand on change de vue ou de mois", () => {
    render(<EventCalendar days={days} selectedDate={selectedDate} today={selectedDate} mode="individuel" pote="ami" view="mois" totalUsers={2} viewerId="me" canManageCommunityDates={false} />);
    expect(screen.getByRole("link", { name: "Semaine" }).getAttribute("href")).toBe("/calendrier?date=2026-10-08&mode=individuel&pote=ami&vue=semaine");
    expect(screen.getByRole("link", { name: "Mois suivant" }).getAttribute("href")).toContain("date=2026-11-01&mode=individuel&pote=ami");
    expect(screen.getByRole("link", { name: /Afficher jeudi 8 octobre/ }).getAttribute("aria-pressed")).toBe("true");
  });
  it("affiche sept jours lundi-dimanche et les flèches de semaine", () => {
    render(<EventCalendar days={days} selectedDate={selectedDate} today={selectedDate} mode="collectif" potes="a,b" view="semaine" totalUsers={2} viewerId="me" canManageCommunityDates={false} />);
    expect(screen.getAllByRole("link", { name: /^Afficher / })).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Semaine précédente" }).getAttribute("href")).toBe("/calendrier?date=2026-10-01&potes=a%2Cb&vue=semaine");
    expect(screen.getByRole("link", { name: "Semaine suivante" }).getAttribute("href")).toContain("date=2026-10-15");
  });
  it("l'agenda ouvre les vraies routes et la création préremplit la date choisie", () => {
    const data = days.map((day) => day.date.getTime() === selectedDate.getTime() ? { ...day, sessions: [{ id: "soirée-a", date: new Date("2026-10-08T20:00:00Z"), status: "SCHEDULED" as const, createdById: "me", votingDeadline: null, decidedGameName: "Jeu réel", decidedGameCoverUrl: null, proposals: [], players: [] }], roulettes: [{ id: "roulette-a", scheduledAt: new Date("2026-10-08T21:00:00Z"), deadline: selectedDate }] } : day);
    render(<EventCalendar days={data} selectedDate={selectedDate} today={selectedDate} mode="collectif" view="mois" totalUsers={2} viewerId="me" canManageCommunityDates={false} />);
    const agenda = within(screen.getByRole("complementary", { name: "Programme du jour" }));
    expect(agenda.getByRole("link", { name: /Jeu réel/ }).getAttribute("href")).toBe("/sessions/soirée-a");
    expect(agenda.getByRole("link", { name: /Le hasard choisira/ }).getAttribute("href")).toBe("/roulette/roulette-a");
    expect(agenda.getByRole("link", { name: /Proposer une soirée/ }).getAttribute("href")).toBe("/sessions?date=2026-10-08#nouvelle-soiree");
  });
  it("une soirée annulée sans jeu choisi n'est pas affichée comme un vote ouvert", () => {
    const data = days.map((day) => day.date.getTime() === selectedDate.getTime() ? { ...day, sessions: [{ id: "cancelled", date: selectedDate, status: "CANCELLED" as const, createdById: "me", votingDeadline: null, decidedGameName: null, decidedGameCoverUrl: null, proposals: [], players: [] }] } : day);
    render(<EventCalendar days={data} selectedDate={selectedDate} today={selectedDate} mode="collectif" view="mois" totalUsers={2} viewerId="me" canManageCommunityDates={false} />);
    expect(screen.getByRole("link", { name: /Soirée · Annulée/ })).toBeTruthy();
    expect(screen.queryByText(/vote ouvert/i)).toBeNull();
  });
});
