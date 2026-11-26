import { describe, expect, it } from "vitest";
import { normalizeSensitiveOperation } from "./sensitive-operation-log";

describe("normalizeSensitiveOperation", () => {
  it("garde les identifiants et codes courts", () => {
    expect(normalizeSensitiveOperation({ actorId: "u1", action: "community.teams", communityId: "c1", target: "t-1", outcome: "teams-ok" }))
      .toEqual({ actorId: "u1", action: "community.teams", communityRef: "c1", target: "t-1", outcome: "teams-ok" });
  });
  it("n'enregistre jamais de texte libre : valeurs hors format remplacées", () => {
    expect(normalizeSensitiveOperation({ actorId: "u1", action: "player.xp_adjust", target: "<script>alert(1)</script>", outcome: "motif saisi par l'admin" }))
      .toMatchObject({ target: null, outcome: "invalid" });
    expect(normalizeSensitiveOperation({ actorId: "", action: "auth.force_relogin", outcome: "ok" }).actorId).toBeNull();
    expect(normalizeSensitiveOperation({ actorId: "u1", action: "auth.force_relogin", target: "x".repeat(192), outcome: "ok" }).target).toBeNull();
  });
  it("autorise la publication du panneau après le contrôle propriétaire", () => {
    expect(normalizeSensitiveOperation({ actorId: "u1", action: "discord.welcome_panel_publish", target: "123456789012345678", outcome: "published" }))
      .toMatchObject({ actorId: "u1", action: "discord.welcome_panel_publish", target: "123456789012345678", outcome: "published" });
  });
  it("refuse une action inconnue (liste fermée)", () => {
    expect(() => normalizeSensitiveOperation({ actorId: "u1", action: "inconnue" as never, outcome: "ok" })).toThrow(/inconnue/);
  });
});
