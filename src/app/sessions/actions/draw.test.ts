import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, checkRateLimit, drawSessionGame, redirect, revalidatePath, gameFindMany } = vi.hoisted(
  () => ({
    getCurrentUser: vi.fn(),
    checkRateLimit: vi.fn(),
    drawSessionGame: vi.fn(),
    redirect: vi.fn((location: string) => {
      throw new Error(`REDIRECT:${location}`);
    }),
    revalidatePath: vi.fn(),
    gameFindMany: vi.fn(),
  })
);

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/sessions", () => ({ drawSessionGame }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: gameFindMany } } }));

import { drawSessionGameAction } from "./draw";
import { INITIAL_DRAW_STATE } from "./draw-types";

/**
 * V2 — `drawSessionGameAction` n'est qu'une fine enveloppe autour de
 * `drawSessionGame` (src/lib/sessions.ts, dont les règles d'éligibilité,
 * le tirage et les garanties de concurrence sont couvertes contre une
 * vraie base Postgres dans session-announce.integration.test.ts) : ces
 * tests vérifient uniquement le comportement PROPRE à l'action serveur —
 * session requise, id validé, acteur authentifié jamais substitué,
 * mapping fidèle de chaque issue métier vers un état affichable, jamais
 * un `gameId` accepté depuis le client.
 */
describe("drawSessionGameAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });

  function formData(sessionId: string): FormData {
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    return fd;
  }

  it("refuse sans session utilisateur — jamais d'appel à drawSessionGame", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(
      drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"))
    ).rejects.toThrow("REDIRECT:/");
    expect(drawSessionGame).not.toHaveBeenCalled();
  });

  it("rate-limité — jamais d'appel à drawSessionGame, état 'error'", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    checkRateLimit.mockReturnValue(false);

    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));
    expect(state).toEqual({ status: "error" });
    expect(drawSessionGame).not.toHaveBeenCalled();
  });

  it("id de session vide (formulaire forgé) — jamais transmis à drawSessionGame", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData(""));
    expect(state).toEqual({ status: "error" });
    expect(drawSessionGame).not.toHaveBeenCalled();
  });

  it("appelle drawSessionGame avec l'id de session ET l'acteur AUTHENTIFIÉ — jamais un acteur pioché ailleurs dans le formulaire (aucun champ 'actorId' n'existe)", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    drawSessionGame.mockResolvedValue({ kind: "no_eligible_game" });

    await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));

    expect(drawSessionGame).toHaveBeenCalledWith("session-1", "createur-1");
    expect(revalidatePath).toHaveBeenCalledWith("/sessions/session-1");
    expect(revalidatePath).toHaveBeenCalledWith("/sessions");
  });

  it("issue 'not_found' — état 'error' générique, jamais de détail exposé", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    drawSessionGame.mockResolvedValue({ kind: "not_found" });
    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));
    expect(state).toEqual({ status: "error" });
  });

  it("issue 'not_creator' (requête forgée par un invité non créateur) — état 'error' générique", async () => {
    getCurrentUser.mockResolvedValue({ id: "invite-1" });
    drawSessionGame.mockResolvedValue({ kind: "not_creator" });
    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));
    expect(state).toEqual({ status: "error" });
  });

  it("issue 'not_voting' (déjà décidée par un autre chemin) — état 'already_decided', jamais une erreur", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    drawSessionGame.mockResolvedValue({ kind: "not_voting", status: "SCHEDULED", decidedGameId: "game-1" });
    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));
    expect(state).toEqual({ status: "already_decided" });
  });

  it("issue 'no_eligible_game' — état correspondant, jamais une erreur générique", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    drawSessionGame.mockResolvedValue({ kind: "no_eligible_game" });
    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));
    expect(state).toEqual({ status: "no_eligible_game" });
  });

  it("issue 'drawn' — relit les noms/couvertures des jeux APRÈS le commit (jamais réutilisés depuis un aperçu client), dans le MÊME ordre que candidateGameIds", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    drawSessionGame.mockResolvedValue({
      kind: "drawn",
      winnerGameId: "game-b",
      candidateGameIds: ["game-a", "game-b", "game-c"],
    });
    gameFindMany.mockResolvedValue([
      { id: "game-c", name: "C", coverUrl: null },
      { id: "game-a", name: "A", coverUrl: "cover-a" },
      { id: "game-b", name: "B", coverUrl: "cover-b" },
    ]);

    const state = await drawSessionGameAction(INITIAL_DRAW_STATE, formData("session-1"));

    expect(gameFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["game-a", "game-b", "game-c"] } },
      select: { id: true, name: true, coverUrl: true },
    });
    expect(state).toEqual({
      status: "drawn",
      winnerGameId: "game-b",
      winnerGameName: "B",
      winnerGameCoverUrl: "cover-b",
      candidates: [
        { id: "game-a", name: "A", coverUrl: "cover-a" },
        { id: "game-b", name: "B", coverUrl: "cover-b" },
        { id: "game-c", name: "C", coverUrl: null },
      ],
    });
  });
});
