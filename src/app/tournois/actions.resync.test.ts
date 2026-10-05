import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  checkRateLimit,
  redirect,
  revalidatePath,
  tournamentFindUnique,
  resyncTournamentThreadMembers,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  revalidatePath: vi.fn(),
  tournamentFindUnique: vi.fn(),
  resyncTournamentThreadMembers: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/prisma", () => ({ prisma: { tournament: { findUnique: tournamentFindUnique } } }));
vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: async () => ({ tournament: { findUnique: tournamentFindUnique } }),
}));
vi.mock("@/lib/tournaments", () => ({
  cancelTournament: vi.fn(),
  deleteTournament: vi.fn(),
  generateBracket: vi.fn(),
  declareWinner: vi.fn(),
  buildBracketInTransaction: vi.fn(),
}));
vi.mock("@/lib/tournament-announce", () => ({
  enqueueTournamentCreationDeliveries: vi.fn(),
  enqueueTournamentThreadMember: vi.fn(),
  resyncTournamentThreadMembers,
}));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/discord", () => ({ postToDiscord: vi.fn(), ACCENT_COLOR: 0 }));
vi.mock("@/lib/app-url", () => ({ resolveAbsoluteUrl: vi.fn() }));
vi.mock("@/lib/discord-bot-config", () => ({ getTournamentAnnounceConfig: vi.fn(() => null) }));

import { resyncTournamentThreadMembersAction } from "./actions";

/**
 * Chantier auto-adhésion aux fils de tournois (V2) — `resyncTournamentThreadMembersAction`
 * réservée au CRÉATEUR (la logique de resynchronisation elle-même —
 * dédoublonnage, absence de reping — est couverte contre une vraie base
 * Postgres dans `tournament-announce.integration.test.ts`, describe "V2 —
 * adhésion automatique au fil du tournoi") : ces tests vérifient
 * uniquement l'autorisation propre à cette action serveur.
 */
describe("resyncTournamentThreadMembersAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });

  function formData(tournamentId: string): FormData {
    const fd = new FormData();
    fd.set("tournamentId", tournamentId);
    return fd;
  }

  it("refuse sans session utilisateur — jamais de resynchronisation", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(resyncTournamentThreadMembersAction(formData("t1"))).rejects.toThrow("REDIRECT:/");
    expect(resyncTournamentThreadMembers).not.toHaveBeenCalled();
  });

  it("non-créateur — jamais déclenchable pour resynchroniser le fil de quelqu'un d'autre", async () => {
    getCurrentUser.mockResolvedValue({ id: "pas-le-createur" });
    tournamentFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: true });

    await resyncTournamentThreadMembersAction(formData("tournoi-1"));

    expect(resyncTournamentThreadMembers).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("tournoi sans announceViaBot (webhook) — rien à resynchroniser côté bot", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    tournamentFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: false });

    await resyncTournamentThreadMembersAction(formData("tournoi-1"));

    expect(resyncTournamentThreadMembers).not.toHaveBeenCalled();
  });

  it("créateur, announceViaBot=true : déclenche la resynchronisation", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    tournamentFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: true });

    await resyncTournamentThreadMembersAction(formData("tournoi-1"));

    expect(resyncTournamentThreadMembers).toHaveBeenCalledWith("tournoi-1");
    expect(revalidatePath).toHaveBeenCalledWith("/tournois/tournoi-1");
  });
});
