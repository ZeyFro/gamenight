import { describe, expect, it } from "vitest";
import { rouletteVetoRefusal } from "@/lib/roulette-veto";

const now = new Date("2026-10-14T12:00:00Z");
const ok = {
  rouletteStatus: "DONE",
  hasResultSession: true,
  sessionStatus: "SCHEDULED",
  sessionDate: new Date("2026-10-20T20:00:00Z"),
  isParticipant: true,
  alreadyVetoed: false,
  now,
} as const;

describe("rouletteVetoRefusal", () => {
  it("aucun refus : roulette tirée, soirée future planifiée, participant sans veto", () => {
    expect(rouletteVetoRefusal(ok)).toBeNull();
  });
  it.each([
    [{ rouletteStatus: "OPEN" }, "closed"],
    [{ hasResultSession: false }, "closed"],
    [{ sessionStatus: "CANCELLED" }, "closed"],
    [{ sessionStatus: "DONE" }, "closed"],
    [{ sessionDate: new Date("2026-10-14T12:00:00Z") }, "closed"], // début atteint
    [{ sessionDate: new Date("2026-10-01T12:00:00Z") }, "closed"],
    [{ isParticipant: false }, "not_participant"],
    [{ alreadyVetoed: true }, "already_vetoed"],
  ] as const)("%j -> %s", (patch, error) => {
    expect(rouletteVetoRefusal({ ...ok, ...patch })).toBe(error);
  });
});
