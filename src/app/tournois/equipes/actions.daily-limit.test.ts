import { beforeEach, describe, expect, it, vi } from "vitest";

/** Plafond de 5 tournois par jour (audit 1.14) pour les tournois par équipes : message clair, redirection vers la liste. */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  createTeamTournament: vi.fn(),
  getCommunityId: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tournament-teams", () => ({
  createTeamTournament: mocks.createTeamTournament,
  getTournamentTeamsCommunityId: mocks.getCommunityId,
  enterTeamInTournament: vi.fn(),
  inviteTeamToTournament: vi.fn(),
  launchTeamTournament: vi.fn(),
  leaveTeamTournament: vi.fn(),
  resolveMatchByReferee: vi.fn(),
  submitMatchReport: vi.fn(),
}));

import { createTeamTournamentAction } from "./actions";

function form(): FormData {
  const fd = new FormData();
  fd.set("name", "Coupe d'équipes");
  fd.set("gameId", "game-1");
  fd.set("maxTeams", "4");
  return fd;
}

describe("createTeamTournamentAction — plafond de tournois par jour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "organizer" });
    mocks.getCommunityId.mockResolvedValue("c1");
    mocks.checkRateLimit.mockReturnValue(true);
  });

  it("au-delà du plafond : redirection vers la liste avec le code de quota", async () => {
    mocks.createTeamTournament.mockResolvedValue({ result: "daily_limit" });
    await expect(createTeamTournamentAction(form())).rejects.toThrow("REDIRECT:/tournois/equipes?result=quota_tournois_jour");
  });

  it("sous le plafond : comportement inchangé (tournoi créé)", async () => {
    mocks.createTeamTournament.mockResolvedValue({ result: "created", tournamentId: "t9" });
    await expect(createTeamTournamentAction(form())).rejects.toThrow("REDIRECT:/tournois/equipes/t9?result=created");
  });
});
