import { describe, expect, it } from "vitest";
import { planSessionSeats, isSeatReminderRecipient, type SeatEntry } from "./session-seat-plan";
const row = (userId: string, status: SeatEntry["status"], time: number): SeatEntry => ({ userId, status, requestedAt: new Date(time) });
describe("répartition des places", () => {
  it("revalide les rappels en file, sans changer les rappels du créateur ni le parcours historique", () => {
    expect(isSeatReminderRecipient(2, "host", "waiting", ["confirmed"])).toBe(false);
    expect(isSeatReminderRecipient(2, "host", "confirmed", ["confirmed"])).toBe(true);
    expect(isSeatReminderRecipient(2, "host", "host", [])).toBe(true);
    expect(isSeatReminderRecipient(null, "host", "waiting", [])).toBe(true);
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
  it("refuse de retirer une place déjà confirmée ou une capacité invalide", () => {
    expect(() => planSessionSeats([row("a", "CONFIRMED", 1), row("b", "CONFIRMED", 2)], new Set(["a", "b"]), 1)).toThrow();
    for (const limit of [0, 101, 1.5, NaN]) expect(() => planSessionSeats([], new Set(), limit)).toThrow();
  });
});
