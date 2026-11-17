import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPTAIN_UNSET_LABEL,
  isTeamCaptain,
  resolveTeamCaptain,
  teamCaptainId,
  type TeamCaptainSource,
} from "./community-team-captain";

const root = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const CAPTAIN = "user-capitaine";
const team = (over: Partial<TeamCaptainSource> = {}): TeamCaptainSource => ({
  createdById: CAPTAIN,
  activeMemberIds: [CAPTAIN],
  ...over,
});

describe("capitainerie — source métier unique", () => {
  it("identifie le créateur même en dernière position de la liste", () => {
    const last = team({ activeMemberIds: ["user-a", "user-b", CAPTAIN] });
    expect(resolveTeamCaptain(last)).toEqual({ kind: "CAPTAIN", userId: CAPTAIN });
    expect(teamCaptainId(last)).toBe(CAPTAIN);
  });

  it("identifie le créateur même en troisième position", () => {
    const third = team({ activeMemberIds: ["user-b", "user-a", CAPTAIN, "user-c"] });
    expect(teamCaptainId(third)).toBe(CAPTAIN);
  });

  it("garde le même capitaine quel que soit l’ordre des membres", () => {
    const orders = [
      [CAPTAIN, "user-a", "user-b"],
      ["user-a", "user-b", CAPTAIN],
      ["user-b", CAPTAIN, "user-a"],
    ];
    const captains = orders.map((activeMemberIds) => teamCaptainId(team({ activeMemberIds })));
    expect(new Set(captains)).toEqual(new Set([CAPTAIN]));
  });

  it("ne désigne personne quand le capitaine n’est pas renseigné", () => {
    const orphan = team({ createdById: null, activeMemberIds: ["user-a", "user-b"] });
    expect(resolveTeamCaptain(orphan)).toEqual({ kind: "NONE" });
    expect(teamCaptainId(orphan)).toBeNull();
    expect(isTeamCaptain(orphan, "user-a")).toBe(false);
  });

  it("n’invente pas de capitaine quand le créateur n’est plus membre actif", () => {
    const left = team({ createdById: "user-parti", activeMemberIds: ["user-a", "user-b"] });
    expect(resolveTeamCaptain(left)).toEqual({ kind: "NONE" });
    // Le premier membre de la liste n’est jamais promu par défaut.
    expect(isTeamCaptain(left, "user-a")).toBe(false);
  });

  it("ne présente jamais un membre ordinaire comme capitaine", () => {
    const full = team({ activeMemberIds: [CAPTAIN, "user-a", "user-b"] });
    for (const member of ["user-a", "user-b"]) {
      expect(isTeamCaptain(full, member)).toBe(false);
    }
    expect(isTeamCaptain(full, CAPTAIN)).toBe(true);
  });

  it("ne déduit aucune permission : le module ne renvoie qu’une identité", () => {
    const result = resolveTeamCaptain(team());
    expect(Object.keys(result).sort()).toEqual(["kind", "userId"]);
    const source = read("src/lib/community-team-captain.ts");
    for (const forbidden of ["permission", "role", "canManage", "isAdmin", "allow"]) {
      expect(source.toLowerCase(), forbidden).not.toContain(`export function ${forbidden}`);
    }
    expect(CAPTAIN_UNSET_LABEL).toBe("Capitaine non renseigné");
  });

  it("n’utilise ni la position, ni l’ancienneté, ni le tri", () => {
    const source = read("src/lib/community-team-captain.ts");
    for (const forbidden of ["members[0]", "joinedAt", ".sort(", "memberIds[0]", "createdAt"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("cohérence Discord ↔ GameNight", () => {
  it("les deux surfaces lisent la même règle, sans la recopier", () => {
    const discord = read("src/lib/discord-team-commands.ts");
    const profile = read("src/lib/discord-community-profile.ts");
    expect(discord).toContain("@/lib/community-team-captain");
    expect(profile).toContain("@/lib/community-team-captain");
    // Aucune surface ne refait la comparaison à la main.
    expect(discord).not.toMatch(/createdById === userId/);
    expect(profile).not.toMatch(/createdById === user\.id/);
  });

  it("aucune commande Discord ne désigne le premier membre comme capitaine", () => {
    for (const file of ["src/lib/discord-team-commands.ts", "src/lib/discord-community-profile.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/memberIds\[0\]/);
      expect(source, file).not.toMatch(/members\[0\]/);
    }
  });
});
