import { expect, it } from "vitest";

const files = import.meta.glob("./tower-temp-voice-cleanup.ts", { eager: true });
function decide() {
  const feature = files["./tower-temp-voice-cleanup.ts"] as {
    decideTemporaryVoiceCleanup: (input: typeof ready) => "keep" | "delete";
  } | undefined;
  expect(feature?.decideTemporaryVoiceCleanup).toBeTypeOf("function");
  return feature!.decideTemporaryVoiceCleanup;
}
const observation = { revision: "new", members: 0, observedAtMs: 9_800, emptySinceMs: 6_000 as number | null };
const ready = {
  room: { kind: "temporary" as "temporary" | "persistent", managed: true, revision: "new" },
  occupancy: observation as typeof observation | null,
  nowMs: 10_000, graceMs: 4_000, maxObservationAgeMs: 200,
};

it("propose le nettoyage uniquement après le délai avec une observation fraîche", () => {
  expect(decide()(ready)).toBe("delete");
  expect(decide()({ ...ready, graceMs: 4_001 })).toBe("keep");
  expect(decide()({ ...ready, maxObservationAgeMs: 199 })).toBe("keep");
});

it("garde un vocal permanent, non géré, occupé ou inconnu", () => {
  expect(decide()({ ...ready, room: { ...ready.room, kind: "persistent" } })).toBe("keep");
  expect(decide()({ ...ready, room: { ...ready.room, managed: false } })).toBe("keep");
  expect(decide()({ ...ready, occupancy: null })).toBe("keep");
  expect(decide()({ ...ready, occupancy: { ...observation, members: 1 } })).toBe("keep");
  expect(decide()({ ...ready, occupancy: { ...observation, emptySinceMs: null } })).toBe("keep");
});

it("garde le vocal en cas de révision ancienne ou d’horodatage incohérent", () => {
  expect(decide()({ ...ready, occupancy: { ...observation, revision: "old" } })).toBe("keep");
  expect(decide()({ ...ready, occupancy: { ...observation, observedAtMs: 10_001 } })).toBe("keep");
  expect(decide()({ ...ready, occupancy: { ...observation, emptySinceMs: -1 } })).toBe("keep");
  expect(decide()({ ...ready, graceMs: 0 })).toBe("keep");
  expect(decide()({ ...ready, nowMs: Number.NaN })).toBe("keep");
});
