import { describe, expect, it } from "vitest";
import merge from "../../scripts/discord-command-merge.cjs";

describe("Discord command registration merge", () => {
  it("preserves unrelated commands and replaces only Tower command names", () => {
    const existing = [
      { name: "gamenight", description: "existing" },
      { name: "tower", description: "old Tower" },
    ];
    const requested = [
      { name: "tower", description: "Tower 2.0" },
      { name: "tower-admin", description: "Tower admin" },
    ];

    expect(merge(existing, requested)).toEqual([
      existing[0],
      requested[0],
      requested[1],
    ]);
  });

  it("rejects malformed command lists instead of replacing with an empty set", () => {
    expect(() => merge(null, [{ name: "tower" }])).toThrow("arrays");
    expect(() => merge([{ description: "missing name" }], [])).toThrow("name");
  });

  it("does not replace a different Discord command type with the same name", () => {
    const existing = [
      { name: "tower", type: 2 },
      { name: "gamenight", type: 1 },
    ];
    const requested = [{ name: "tower", type: 1 }];

    expect(merge(existing, requested)).toEqual([existing[0], existing[1], requested[0]]);
  });
});

