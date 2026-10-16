import { describe, expect, it } from "vitest";
import { planSessionSeats, isPromotionDmRecipient, isSeatReminderRecipient, type SeatEntry } from "./session-seat-plan";
const row = (userId: string, status: SeatEntry["status"], time: number): SeatEntry => ({ userId, status, requestedAt: new Date(time) });
describe("répartition des places", () => {
  it("revalide les rappels en file, sans changer les rappels du créateur ni le parcours historique", () => {
    expect(isSeatReminderRecipient(2, "host", "waiting", ["confirmed"])).toBe(false);
    expect(isSeatReminderRecipient(2, "host", "confirmed", ["confirmed"])).toBe(true);
    expect(isSeatReminderRecipient(2, "host", "host", [])).toBe(true);
    expect(isSeatReminderRecipient(null, "host", "waiting", [])).toBe(true);
    expect(isSeatReminderRecipient(null, "host", "declined", ["confirmed"], true)).toBe(false);
    expect(isSeatReminderRecipient(null, "host", "host", [], true)).toBe(true);
  });
  it("ne livre un DM de promotion que si la capacité est active et que le joueur est encore confirmé", () => {
    expect(isPromotionDmRecipient("SCHEDULED", 2, "alice", ["alice"])).toBe(true);
    expect(isPromotionDmRecipient("SCHEDULED", 2, "alice", [])).toBe(false);
    expect(isPromotionDmRecipient("SCHEDULED", null, "alice", ["alice"])).toBe(false);
    expect(isPromotionDmRecipient("DONE", 2, "alice", ["alice"])).toBe(false);
  });
  it("conserve le confirmé puis promeut le premier en FIFO sans dépasser la capacité", () => {
    const plan = planSessionSeats([row("host", "CONFIRMED", 10), row("b", "WAITLIST", 3), row("a", "WAITLIST", 2)], new Set(["host", "a", "b"]), 2);
    expect([...plan]).toEqual([["host", "CONFIRMED"], ["b", "WAITLIST"], ["a", "CONFIRMED"]]);
  });
  it("ignore un membre retiré ou un désistement, même en tête de file", () => {
    const plan = planSessionSeats([row("gone", "CONFIRMED", 1), row("declined", "DECLINED", 0), row("removed", "WAITLIST", 2), row("next", "WAITLIST", 3)], new Set(["declined", "next"]), 1);
    expect([...plan]).toEqual([["gone", "DECLINED"], ["declined", "DECLINED"], ["removed", "DECLINED"], ["next", "CONFIRMED"]]);
  });
  it("départage les inscriptions simultanées de manière stable", () => {
    expect(planSessionSeats([row("b", "WAITLIST", 1), row("a", "WAITLIST", 1)], new Set(["a", "b"]), 1).get("a")).toBe("CONFIRMED");
  });
  it("confirme sans limite tous les invités qui n'ont pas décliné", () => {
    const plan = planSessionSeats([row("a", "WAITLIST", 1), row("b", "CONFIRMED", 2), row("c", "DECLINED", 3), row("gone", "WAITLIST", 4)], new Set(["a", "b", "c"]), null);
    expect([...plan]).toEqual([["a", "CONFIRMED"], ["b", "CONFIRMED"], ["c", "DECLINED"], ["gone", "DECLINED"]]);
  });
  it("refuse de retirer une place déjà confirmée ou une capacité invalide", () => {
    expect(() => planSessionSeats([row("a", "CONFIRMED", 1), row("b", "CONFIRMED", 2)], new Set(["a", "b"]), 1)).toThrow();
    for (const limit of [0, 101, 1.5, NaN]) expect(() => planSessionSeats([], new Set(), limit)).toThrow();
  });
});
