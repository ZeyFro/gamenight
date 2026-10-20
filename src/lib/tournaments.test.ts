import { describe, it, expect } from "vitest";
import {
  bracketSizeFor,
  totalRoundsFor,
  computeMatchLoser,
  computeNextSlot,
  isTournamentVisibleInHistory,
  getActiveTournamentStatusLabel,
  pairTournamentParticipants,
  tournamentBracketSize,
} from "@/lib/tournaments";

describe("getActiveTournamentStatusLabel", () => {
  it("announces open registration instead of calling it in progress", () => {
    expect(getActiveTournamentStatusLabel("REGISTRATION")).toBe("Inscriptions ouvertes");
  });

  it("labels a bracket that has started as in progress", () => {
    expect(getActiveTournamentStatusLabel("IN_PROGRESS")).toBe("Tournoi en cours");
  });
});

describe("pairTournamentParticipants", () => {
  it("persists players in pairs and rejects an incomplete team bracket", () => {
    expect(pairTournamentParticipants(["a", "b", "c", "d"])).toEqual([["a", "b"], ["c", "d"]]);
    expect(pairTournamentParticipants(["a", "b", "c"])).toBeNull();
    expect(pairTournamentParticipants(["a", "b"])).toBeNull();
  });
});

describe("tournamentBracketSize", () => {
  it("sizes team brackets by duos while preserving individual brackets", () => {
    expect(tournamentBracketSize(4, "TEAMS")).toBe(2);
    expect(tournamentBracketSize(6, "TEAMS")).toBe(4);
    expect(tournamentBracketSize(8, "TEAMS")).toBe(4);
    expect(tournamentBracketSize(6, "INDIVIDUAL")).toBe(8);
  });
});

describe("bracketSizeFor (Sprint 5, Tournois Bracket)", () => {
  it("retourne maxPlayers tel quel quand c'est déjà une puissance de 2", () => {
    expect(bracketSizeFor(4)).toBe(4);
    expect(bracketSizeFor(8)).toBe(8);
  });

  it("arrondit à la puissance de 2 supérieure sinon (6 joueurs -> bracket à 8 slots)", () => {
    expect(bracketSizeFor(6)).toBe(8);
  });
});

describe("totalRoundsFor", () => {
  it("calcule le nombre de rounds pour chaque taille de bracket supportée", () => {
    expect(totalRoundsFor(4)).toBe(2);
    expect(totalRoundsFor(8)).toBe(3);
  });
});

describe("computeMatchLoser (PR Atomicité saisons + tournois)", () => {
  it("le perdant est l'autre joueur quand le gagnant est player1", () => {
    expect(computeMatchLoser("p1", "p1", "p2")).toBe("p2");
  });

  it("le perdant est l'autre joueur quand le gagnant est player2", () => {
    expect(computeMatchLoser("p2", "p1", "p2")).toBe("p1");
  });

  it("renvoie null si l'autre slot est vide (bye)", () => {
    expect(computeMatchLoser("p1", "p1", null)).toBeNull();
  });
});

/**
 * Cycle de vie de l'historique (V2, bug remonté en test réel). `now`
 * passé explicitement (pas de fake timers ici, cette fonction accepte
 * déjà `now` en paramètre).
 */
describe("isTournamentVisibleInHistory", () => {
  const now = new Date("2026-09-22T10:00:00Z");

  it("un tournoi encore actif (REGISTRATION/IN_PROGRESS) reste TOUJOURS visible, quel que soit son âge", () => {
    expect(
      isTournamentVisibleInHistory(
        { status: "REGISTRATION", cancelledAt: null, matches: [] },
        now
      )
    ).toBe(true);
    expect(
      isTournamentVisibleInHistory(
        { status: "IN_PROGRESS", cancelledAt: null, matches: [] },
        now
      )
    ).toBe(true);
  });

  it("CANCELLED récent (cancelledAt d'hier) : encore visible", () => {
    expect(
      isTournamentVisibleInHistory(
        { status: "CANCELLED", cancelledAt: new Date("2026-09-21T20:00:00Z"), matches: [] },
        now
      )
    ).toBe(true);
  });

  it("CANCELLED ancien (cancelledAt il y a plus de 7 jours) : sort de l'historique", () => {
    expect(
      isTournamentVisibleInHistory(
        { status: "CANCELLED", cancelledAt: new Date("2026-09-01T20:00:00Z"), matches: [] },
        now
      )
    ).toBe(false);
  });

  it("CANCELLED sans cancelledAt (ligne historique incohérente) : repli prudent, jamais masqué", () => {
    expect(
      isTournamentVisibleInHistory({ status: "CANCELLED", cancelledAt: null, matches: [] }, now)
    ).toBe(true);
  });

  it("DONE : dérive la fin réelle du plus RÉCENT completedAt parmi tous les matchs (la finale), jamais createdAt ni une date inventée", () => {
    const matches = [
      { completedAt: new Date("2026-09-10T20:00:00Z") }, // round 1
      { completedAt: new Date("2026-09-15T20:00:00Z") }, // finale, la plus récente
    ];
    // La finale (15 septembre) est dans la fenêtre de 7 jours depuis le 22.
    expect(isTournamentVisibleInHistory({ status: "DONE", cancelledAt: null, matches }, now)).toBe(
      true
    );
  });

  it("DONE ancien (finale il y a plus de 7 jours) : sort de l'historique", () => {
    const matches = [{ completedAt: new Date("2026-09-01T20:00:00Z") }];
    expect(isTournamentVisibleInHistory({ status: "DONE", cancelledAt: null, matches }, now)).toBe(
      false
    );
  });

  it("DONE sans le moindre completedAt (ligne historique incohérente) : repli prudent, jamais masqué", () => {
    expect(
      isTournamentVisibleInHistory({ status: "DONE", cancelledAt: null, matches: [] }, now)
    ).toBe(true);
    expect(
      isTournamentVisibleInHistory(
        { status: "DONE", cancelledAt: null, matches: [{ completedAt: null }] },
        now
      )
    ).toBe(true);
  });
});

describe("computeNextSlot (PR Atomicité saisons + tournois)", () => {
  it("position paire -> player1Id du match floor(position/2) du round suivant", () => {
    expect(computeNextSlot(1, 0)).toEqual({ nextRound: 2, nextPosition: 0, field: "player1Id" });
    expect(computeNextSlot(1, 2)).toEqual({ nextRound: 2, nextPosition: 1, field: "player1Id" });
  });

  it("position impaire -> player2Id du même match floor(position/2) du round suivant", () => {
    expect(computeNextSlot(1, 1)).toEqual({ nextRound: 2, nextPosition: 0, field: "player2Id" });
    expect(computeNextSlot(1, 3)).toEqual({ nextRound: 2, nextPosition: 1, field: "player2Id" });
  });

  it("2 matchs consécutifs du round N convergent vers le même match du round N+1", () => {
    expect(computeNextSlot(2, 0).nextPosition).toBe(computeNextSlot(2, 1).nextPosition);
    expect(computeNextSlot(2, 0).nextRound).toBe(computeNextSlot(2, 1).nextRound);
  });
});
