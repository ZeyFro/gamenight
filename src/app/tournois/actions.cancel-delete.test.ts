import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, checkRateLimit, cancelTournament, deleteTournament, redirect, revalidatePath } = vi.hoisted(
  () => ({
    getCurrentUser: vi.fn(),
    checkRateLimit: vi.fn(),
    cancelTournament: vi.fn(),
    deleteTournament: vi.fn(),
    redirect: vi.fn((location: string) => {
      throw new Error(`REDIRECT:${location}`);
    }),
    revalidatePath: vi.fn(),
  })
);

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/tournaments", () => ({
  cancelTournament,
  deleteTournament,
  // Non utilisés par ces deux actions, présents pour satisfaire l'import
  // groupé de actions.ts sans avoir à mocker tout le module réel.
  generateBracket: vi.fn(),
  declareWinner: vi.fn(),
  buildBracketInTransaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findUnique: vi.fn() }, user: { findMany: vi.fn() } } }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/discord", () => ({ postToDiscord: vi.fn(), ACCENT_COLOR: 0 }));
vi.mock("@/lib/app-url", () => ({ resolveAbsoluteUrl: vi.fn() }));
vi.mock("@/lib/discord-bot-config", () => ({ getTournamentAnnounceConfig: vi.fn(() => null) }));
vi.mock("@/lib/tournament-announce", () => ({ enqueueTournamentCreationDeliveries: vi.fn() }));

import { cancelTournamentAction, deleteTournamentAction } from "./actions";

/**
 * V2 (annulation/suppression de tournoi) — `cancelTournamentAction`/
 * `deleteTournamentAction` ne sont que de fines enveloppes autour de
 * `cancelTournament`/`deleteTournament` (src/lib/tournaments.ts, dont
 * l'autorisation réelle et les courses sont couvertes par
 * `tournament-announce.integration.test.ts` contre une vraie base
 * Postgres) — ces tests vérifient uniquement le comportement PROPRE à
 * l'action serveur : session requise, validation de l'id, et transmission
 * fidèle de l'acteur authentifié (jamais un id pioché ailleurs dans le
 * formulaire).
 */
describe("cancelTournamentAction / deleteTournamentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });

  function formData(tournamentId: string): FormData {
    const fd = new FormData();
    fd.set("tournamentId", tournamentId);
    return fd;
  }

  it("cancelTournamentAction : refuse sans session utilisateur", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(cancelTournamentAction(formData("t1"))).rejects.toThrow("REDIRECT:/");
    expect(cancelTournament).not.toHaveBeenCalled();
  });

  it("cancelTournamentAction : appelle cancelTournament avec l'id du tournoi et l'utilisateur authentifié", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    cancelTournament.mockResolvedValue({ ok: true });

    await cancelTournamentAction(formData("tournoi-1"));

    expect(cancelTournament).toHaveBeenCalledWith("tournoi-1", "createur-1");
    expect(revalidatePath).toHaveBeenCalledWith("/tournois/tournoi-1");
  });

  it("cancelTournamentAction : échec (non-créateur, mauvais statut...) — aucune revalidation, aucun crash", async () => {
    getCurrentUser.mockResolvedValue({ id: "pas-le-createur" });
    cancelTournament.mockResolvedValue({ ok: false, reason: "not_creator" });

    await cancelTournamentAction(formData("tournoi-1"));

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cancelTournamentAction : id invalide (vide) — jamais transmis à cancelTournament", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    await cancelTournamentAction(formData(""));
    expect(cancelTournament).not.toHaveBeenCalled();
  });

  it("deleteTournamentAction : refuse sans session utilisateur", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(deleteTournamentAction(formData("t1"))).rejects.toThrow("REDIRECT:/");
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it("deleteTournamentAction : appelle deleteTournament puis redirige vers /tournois seulement en cas de succès", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    deleteTournament.mockResolvedValue({ ok: true });

    await expect(deleteTournamentAction(formData("tournoi-1"))).rejects.toThrow("REDIRECT:/tournois");
    expect(deleteTournament).toHaveBeenCalledWith("tournoi-1", "createur-1");
  });

  it("deleteTournamentAction : échec — jamais de redirection (le créateur reste sur la page pour voir pourquoi)", async () => {
    getCurrentUser.mockResolvedValue({ id: "pas-le-createur" });
    deleteTournament.mockResolvedValue({ ok: false, reason: "not_creator" });

    await deleteTournamentAction(formData("tournoi-1"));

    expect(redirect).not.toHaveBeenCalled();
  });
});
