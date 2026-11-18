import { describe, expect, it, vi } from "vitest";

// Règles de pondération de la roulette asynchrone (enrichRouletteCandidates), sans base : tierlist → poids, valeur par
// défaut, moyenne sur les participants, plancher/plafond, et fenêtre « récemment joué » de 7 jours.
const { NOW } = vi.hoisted(() => ({ NOW: new Date("2026-10-23T12:00:00.000Z") }));

vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => NOW }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: {}, scopedTransactionPrisma: {} }));
vi.mock("@/lib/community-isolation", () => ({ cronCommunityScope: vi.fn(), communityMemberUserWhere: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/notify-recipients", () => ({ resolveNotifiedUserIds: vi.fn() }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: vi.fn() }));
vi.mock("@/lib/xp", () => ({ XP_AMOUNTS: {} }));
vi.mock("@/lib/badges", () => ({ checkSessionsCreatedBadges: vi.fn() }));
vi.mock("@/lib/discord-roulette", () => ({ announceRouletteCancelled: vi.fn(), announceRouletteReminder: vi.fn(), announceRouletteResult: vi.fn() }));
vi.mock("@/lib/roulette-dm", () => ({ enqueueRouletteDirectMessageEdits: vi.fn() }));
vi.mock("@/lib/sessions", () => ({ createRouletteResultSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { enrichRouletteCandidates } from "@/lib/roulette";

type Tier = "S" | "A" | "B" | "C" | "D";
const entry = (gameId: string) => ({ gameId, userId: "u", game: { minPlayers: null, maxPlayers: null } });
const setup = (tiers: { gameId: string; tier: Tier }[], recentDecided: (string | null)[] = []) => {
  const tierFind = vi.fn().mockResolvedValue(tiers);
  const sessionFind = vi.fn().mockResolvedValue(recentDecided.map((decidedGameId) => ({ decidedGameId })));
  return {
    tx: { tierlistEntry: { findMany: tierFind } } as never,
    db: { session: { findMany: sessionFind } } as never,
    sessionFind,
  };
};
const weights = async (entries: ReturnType<typeof entry>[], participants: string[], tiers: { gameId: string; tier: Tier }[]) => {
  const { tx, db } = setup(tiers);
  const rows = await enrichRouletteCandidates(tx, db, entries, participants);
  return Object.fromEntries(rows.map((r) => [r.gameId, r.weight]));
};

describe("roulette — poids issus des tierlists", () => {
  it("S=5, A=4, B=3, C=2, D=1 pour un participant", async () => {
    const tiers = (["S", "A", "B", "C", "D"] as const).map((tier) => ({ gameId: `g${tier}`, tier }));
    const w = await weights(tiers.map((t) => entry(t.gameId)), ["p1"], tiers);
    expect(w).toEqual({ gS: 5, gA: 4, gB: 3, gC: 2, gD: 1 });
  });

  it("un jeu sans entrée de tierlist compte 3 pour chaque participant", async () => {
    const w = await weights([entry("inconnu")], ["p1", "p2", "p3"], []);
    expect(w).toEqual({ inconnu: 3 });
  });

  it("moyenne sur les participants : les absents comptent 3", async () => {
    // 2 participants : p1 classe X en S (5), p2 n'a rien classé (3) => (5 + 3) / 2 = 4.
    const w = await weights([entry("X")], ["p1", "p2"], [{ gameId: "X", tier: "S" }]);
    expect(w).toEqual({ X: 4 });
  });

  it("bornes : tous en S => 5 ; tous en D => 1 (plancher)", async () => {
    const three = ["p1", "p2", "p3"];
    const allS = await weights([entry("A")], three, ["p1", "p2", "p3"].map(() => ({ gameId: "A", tier: "S" as const })));
    const allD = await weights([entry("B")], three, ["p1", "p2", "p3"].map(() => ({ gameId: "B", tier: "D" as const })));
    expect(allS.A).toBe(5);
    expect(allD.B).toBe(1);
  });
});

describe("roulette — jeux récemment joués (7 jours)", () => {
  it("interroge les soirées terminées entre maintenant − 7 jours exactement et maintenant", async () => {
    const { tx, db, sessionFind } = setup([]);
    await enrichRouletteCandidates(tx, db, [entry("g1"), entry("g1"), entry("g2")], ["p1"]);
    expect(sessionFind).toHaveBeenCalledOnce();
    const where = sessionFind.mock.calls[0][0].where;
    expect(where.status).toBe("DONE");
    expect(where.date.gte).toEqual(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000));
    expect(where.date.gte.toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(where.date.lte).toEqual(NOW);
    expect(where.decidedGameId.in.sort()).toEqual(["g1", "g2"]);
  });

  it("marque recentlyPlayed uniquement pour les jeux décidés récemment (null ignoré)", async () => {
    const { tx, db } = setup([], ["g1", null]);
    const rows = await enrichRouletteCandidates(tx, db, [entry("g1"), entry("g2")], ["p1"]);
    expect(Object.fromEntries(rows.map((r) => [r.gameId, r.recentlyPlayed]))).toEqual({ g1: true, g2: false });
  });
});
