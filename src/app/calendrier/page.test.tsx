// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CalendarData } from "@/lib/calendar";

const { getCalendarData } = vi.hoisted(() => ({ getCalendarData: vi.fn() }));
vi.mock("@/lib/calendar", () => ({ getCalendarData }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: "me", color: "#aabbcc" }) }));
vi.mock("@/lib/community-picker", () => ({ requireCommunityChosen: async () => undefined }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: async () => "community" }));
vi.mock("@/app/calendrier/actions", () => ({ saveCommunityBirthdayAction: vi.fn(), createCommunityDateAction: vi.fn(), deleteCommunityDateAction: vi.fn() }));
vi.mock("@/lib/community-read-context", () => ({ withCommunityReadContext: (fn: () => unknown) => fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  weeklyAvailability: { findMany: async () => [] },
  availabilityOverride: { findUnique: async () => null },
  membership: { findUnique: async () => ({ role: "OWNER", status: "ACTIVE" }) },
} }));
vi.mock("@/components/PullToRefresh", () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/calendar/DayTimeline", () => ({ DayTimeline: () => <div>Timeline conservée</div> }));
vi.mock("@/components/calendar/PoteFilterDrawer", () => ({ PoteFilterDrawer: ({ users }: { users: { discordName: string }[] }) => <div aria-label="Choix des potes">{users.map(user => user.discordName).join(", ")}</div> }));
vi.mock("@/components/magicui/aurora-text", () => ({ AuroraText: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
  ButtonLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
import CalendrierPage from "./page";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "false");
  getCalendarData.mockReset();
  getCalendarData.mockImplementation(async (_start, _end, _viewer, visibleIds?: string[]): Promise<CalendarData> => {
    const users = [
      { id: "me", discordName: "Toi", discordAvatar: null, color: "#aabbcc" },
      { id: "friend", discordName: "Pote", discordAvatar: null, color: "#aabbcc" },
      { id: "other", discordName: "Autre", discordAvatar: null, color: "#aabbcc" },
    ];
    const availableUserIds = visibleIds ? ["friend", "other"].filter(id => visibleIds.includes(id)) : ["friend", "other"];
    return { users, days: [{ date: new Date("2026-10-08T00:00:00Z"), sessions: [], communityDates: [], hours: [{ hour: 20, availableUserIds }], maxAvailableCount: availableUserIds.length }], bestSlot: null, ownWeeklySlots: [], ownOverrides: [] };
  });
});

describe("calendrier : la grille suit le mode de disponibilité sélectionné", () => {
  it("garde le téléchargement et ne propose l’abonnement que lorsque son flag est actif", async () => {
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08" }) }));
    expect(screen.queryByRole("heading", { name: "S’abonner aux soirées" })).toBeNull();
    cleanup(); vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08" }) }));
    expect(screen.getByRole("heading", { name: "S’abonner aux soirées" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Révoquer le lien de ce serveur" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Télécharger les soirées à venir (.ics)" })).toBeTruthy();
  });
  it("en semaine, ne charge que les sept jours affichés, pas tout le mois", async () => {
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08", vue: "semaine" }) }));
    expect(getCalendarData.mock.calls[0][0]).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(getCalendarData.mock.calls[0][1]).toEqual(new Date("2026-10-12T00:00:00Z"));
    expect(screen.getByRole("link", { name: "Télécharger les soirées à venir (.ics)" }).getAttribute("href")).toBe("/api/calendrier/export");
  });
  it("en individuel, affiche le pote choisi plutôt que les disponibilités du groupe", async () => {
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08", mode: "individuel", pote: "friend", potes: "other,me" }) }));
    expect(getCalendarData.mock.calls[0][3]).toEqual(["friend"]);
    expect(screen.getByText("Disponible")).toBeTruthy();
    expect(screen.queryByText(/\d+\/\d+ dispo/)).toBeNull();
    expect(screen.getByRole("link", { name: "Autre" })).toBeTruthy();
  });
  it("en individuel sans pote, utilise ses propres disponibilités", async () => {
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08", mode: "individuel" }) }));
    expect(getCalendarData.mock.calls[0][3]).toEqual(["me"]);
    expect(screen.queryByText("Disponible")).toBeNull();
  });
  it("en collectif, compte les potes filtrés tout en conservant tous les choix", async () => {
    render(await CalendrierPage({ searchParams: Promise.resolve({ date: "2026-10-08", potes: "friend" }) }));
    expect(getCalendarData.mock.calls[0][3]).toEqual(["friend"]);
    expect(screen.getByText("1/1 dispo")).toBeTruthy();
    expect(within(screen.getByLabelText("Choix des potes")).getByText("Toi, Pote, Autre")).toBeTruthy();
  });
});
