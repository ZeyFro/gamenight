// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/jouer-maintenant/actions", () => ({
  getInstantSessionViewAction: vi.fn(async () => null),
  joinInstantSessionAction: vi.fn(async () => ({ status: "idle" })),
  leaveInstantSessionAction: vi.fn(async () => ({ status: "idle" })),
  toggleInstantSessionInterestAction: vi.fn(async () => ({ status: "idle" })),
}));
vi.mock("@/components/jouer-maintenant/ChangeInstantSessionGameControl", () => ({
  ChangeInstantSessionGameControl: () => null,
}));
vi.mock("@/components/jouer-maintenant/EndInstantSessionDialog", () => ({
  EndInstantSessionDialog: () => null,
}));

import { InstantSessionDetail } from "./InstantSessionDetail";
import type { InstantSessionViewDTO } from "@/lib/instant-sessions";

const NOW = new Date("2026-11-27T20:00:00.000Z");
const HOUR = 3_600_000;

function view(overrides: Partial<InstantSessionViewDTO> = {}): InstantSessionViewDTO {
  return {
    id: "s1",
    status: "ACTIVE",
    game: {
      id: "g1", name: "Jeu test", coverUrl: null,
      jumpscares: null, motionSickness: null, textLanguages: null, audioLanguages: null, warningsUpdatedAt: null,
    },
    creator: { id: "u1", discordName: "Créateur", discordAvatar: null, color: "#ffffff" },
    createdAtIso: new Date(NOW.getTime() - 60_000).toISOString(),
    // Le timestamp stocké est en heure murale Paris ; le navigateur le lit
    // comme 3 h alors que le serveur ne laisse que 2 h moins une minute.
    expiresAtIso: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
    endedAtIso: null,
    endedReason: null,
    timeRemainingMs: 2 * HOUR - 60_000,
    participants: [],
    viewerIsParticipant: true,
    viewerIsCreator: false,
    interested: [],
    viewerIsInterested: false,
    interestEnabled: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InstantSessionDetail — compte à rebours", () => {
  it("affiche 1 h 59 restantes, pas les 3 h du timestamp décalé", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<InstantSessionDetail instantSessionId="s1" currentUserId="u2" initialView={view()} localGames={[]} />);

    expect(screen.getByText("⏳ 1h 59min")).toBeTruthy();
    expect(screen.queryByText("⏳ 3h 00min")).toBeNull();
  });

  it("affiche la durée réelle (2 h) quand la session expire", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<InstantSessionDetail
      instantSessionId="s1"
      currentUserId="u2"
      initialView={view({
        status: "ENDED",
        createdAtIso: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
        expiresAtIso: new Date(NOW.getTime()).toISOString(),
        endedAtIso: new Date(NOW.getTime()).toISOString(),
        endedReason: "expired",
        timeRemainingMs: 0,
      })}
      localGames={[]}
    />);

    expect(screen.getByText(/durée maximale \(2 h\)/)).toBeTruthy();
  });
});
