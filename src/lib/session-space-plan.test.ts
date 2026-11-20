import { describe, expect, it } from "vitest";
import { VIEW_CHANNEL, VOICE_CHANNEL_ALLOW } from "@/lib/discord-team-spaces";
import { buildVoiceOverwrites, selectSpaceMembers, sessionSpaceName } from "./session-space-plan";

const GUILD = "100000000000000001";
const A = "200000000000000001";
const B = "200000000000000002";

describe("sessionSpaceName", () => {
  it("retire les caractères problématiques et borne la longueur", () => {
    const name = sessionSpaceName("Soirée", "vendredi 20 novembre à 20:00 #général @everyone");
    expect(name).not.toMatch(/[#@:/\\`]/);
    expect(sessionSpaceName("Soirée", "x".repeat(300)).length).toBeLessThanOrEqual(90);
  });
});

describe("selectSpaceMembers", () => {
  it("garde l'ordre, dédoublonne et ignore les identifiants invalides ou absents", () => {
    expect(selectSpaceMembers([A, null, "abc", A, undefined, B, "123"])).toEqual([A, B]);
  });
  it("plafonne le nombre de membres", () => {
    const many = Array.from({ length: 200 }, (_, index) => `3${String(index).padStart(17, "0")}`);
    expect(selectSpaceMembers(many)).toHaveLength(90);
    expect(selectSpaceMembers(many, 3)).toHaveLength(3);
  });
});

describe("buildVoiceOverwrites", () => {
  const overwrites = buildVoiceOverwrites(GUILD, [A, B]);

  it("@everyone ne voit pas le vocal", () => {
    expect(overwrites[0]).toEqual({ id: GUILD, type: 0, allow: "0", deny: VIEW_CHANNEL });
  });
  it("chaque participant reçoit seulement voir, se connecter, parler", () => {
    expect(overwrites.slice(1)).toEqual([
      { id: A, type: 1, allow: VOICE_CHANNEL_ALLOW, deny: "0" },
      { id: B, type: 1, allow: VOICE_CHANNEL_ALLOW, deny: "0" },
    ]);
  });
  it("n'accorde jamais de permission de gestion ni d'administration", () => {
    const bits = Number(VOICE_CHANNEL_ALLOW);
    // ADMINISTRATOR = 3, MANAGE_CHANNELS = 4, MANAGE_ROLES = 28, MUTE_MEMBERS = 22, DEAFEN_MEMBERS = 23, MOVE_MEMBERS = 24.
    for (const position of [3, 4, 28, 22, 23, 24]) expect(bits & (1 << position)).toBe(0);
  });
});
