import { describe, expect, it } from "vitest";
import { parseAvailabilityPollInput, rankAvailabilityPollSlots, type AvailabilityPollSlot } from "./session-availability-poll";

const now = new Date("2026-10-15T12:00:00Z");
const input = () => ({ title: "Vendredi ensemble", participantIds: ["alice", "bob"], options: [
  { date: "2026-10-16", time: "23:00", durationMinutes: 120 },
  { date: "2026-10-17", time: "20:00", durationMinutes: 90 },
] });

describe("préparer un sondage de soirée", () => {
  it("conserve les heures saisies et une option qui traverse minuit", () => {
    const result = parseAvailabilityPollInput(input(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots[0].start.toISOString()).toBe("2026-10-16T23:00:00.000Z");
    expect(result.slots[0].end.toISOString()).toBe("2026-10-17T01:00:00.000Z");
  });

  it.each(["2026-02-30", "2026-10-14", "2027-10-16"])("refuse une date inexistante, passée ou hors horizon : %s", date => {
    const value = input(); value.options[0].date = date;
    expect(parseAvailabilityPollInput(value, now).ok).toBe(false);
  });

  it("refuse les doublons d'options et de participants plutôt que les masquer", () => {
    const value = input(); value.options[1] = value.options[0];
    expect(parseAvailabilityPollInput(value, now).ok).toBe(false);
    expect(parseAvailabilityPollInput({ ...input(), participantIds: ["alice", "alice"] }, now).ok).toBe(false);
  });

  it("borne le titre, les options, les participants et la durée", () => {
    for (const value of [
      { ...input(), title: " " }, { ...input(), title: "x".repeat(121) },
      { ...input(), options: input().options.slice(0, 1) },
      { ...input(), participantIds: Array.from({ length: 101 }, (_, i) => String(i)) },
      { ...input(), options: [{ ...input().options[0], durationMinutes: 240 }, input().options[1]] },
    ]) expect(parseAvailabilityPollInput(value, now).ok).toBe(false);
  });
});

describe("résultats du sondage", () => {
  const slot = (id: string, responses: AvailabilityPollSlot["responses"]): AvailabilityPollSlot => ({ id, start: now, end: new Date(now.getTime() + 3_600_000), responses });

  it("ne confond pas sans réponse et indisponible, et ignore les personnes hors liste", () => {
    const [row] = rankAvailabilityPollSlots([slot("a", [{ userId: "alice", answer: "UNAVAILABLE" }, { userId: "étranger", answer: "AVAILABLE" }])], ["alice", "bob"]);
    expect(row).toMatchObject({ available: 0, maybe: 0, unavailable: 1, unanswered: 1 });
    expect(row.responses).toEqual([{ userId: "alice", answer: "UNAVAILABLE" }]);
  });

  it("classe les oui puis peut-être, conserve les ex æquo et un ordre déterministe", () => {
    const yes = { userId: "alice", answer: "AVAILABLE" as const };
    const maybe = { userId: "bob", answer: "MAYBE" as const };
    const rows = rankAvailabilityPollSlots([slot("z", [yes]), slot("b", [yes, maybe]), slot("a", [yes]), slot("c", [])], ["alice", "bob"]);
    expect(rows.map(row => [row.id, row.rank])).toEqual([["b", 1], ["a", 2], ["z", 2], ["c", 4]]);
    expect(rows[3].unanswered).toBe(2);
  });
});
