import { describe, expect, it } from "vitest";

import { buildOverwrites } from "./discord-team-space-api";
import { describeSpaceOutcome } from "./discord-team-commands";

const GUILD = "100000000000000001";
const ROLE = "100000000000000002";

describe("permissions et messages d’espace", () => {
  it("traduit les cibles du plan en overwrites Discord réels", () => {
    expect(
      buildOverwrites(GUILD, ROLE, [
        { target: "everyone", deny: "1024" },
        { target: "team-role", allow: "1024" },
      ])
    ).toEqual([
      { id: GUILD, type: 0, allow: "0", deny: "1024" },
      { id: ROLE, type: 0, allow: "1024", deny: "0" },
    ]);
  });

  it("n’invente jamais d’overwrite sans identifiant de rôle", () => {
    expect(buildOverwrites(GUILD, null, [{ target: "team-role", allow: "1024" }])).toEqual([]);
  });

  it("n’annonce jamais une création qui n’a pas eu lieu", () => {
    expect(describeSpaceOutcome("created")).toContain("créés");
    expect(describeSpaceOutcome("quota")).toContain("non créé");
    expect(describeSpaceOutcome("migration_required")).toContain("non créé");
    expect(describeSpaceOutcome("disabled")).toBe("");
    expect(describeSpaceOutcome("partial")).toContain("partiellement");
  });
});
