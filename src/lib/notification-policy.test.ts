import { describe, expect, it } from "vitest";
import {
  buildGameRolePing,
  isApprovedRolePing,
  isDirectMessageAllowed,
  isPublicAnnouncementAllowed,
  neutralizeEveryoneText,
  stripEveryoneParse,
} from "@/lib/notification-policy";
import type { GuildRoleSummary } from "@/lib/discord-guild-roles";

const role = (id: string, name: string, over: Partial<GuildRoleSummary> = {}): GuildRoleSummary => ({
  id, name, position: 3, permissions: "0", managed: false, ...over,
});

describe("MP seulement pour ce qui vise le joueur", () => {
  it.each(["INVITATION", "APPLICATION", "OWN_CHALLENGE", "CONTESTATION"])("autorise %s", (kind) => {
    expect(isDirectMessageAllowed(kind)).toBe(true);
  });
  it.each(["SESSION_REMINDER", "TOURNAMENT_RESULT", "NEW_RANKER", "BROADCAST", ""])("refuse %s", (kind) => {
    expect(isDirectMessageAllowed(kind)).toBe(false);
  });
});

describe("annonces publiques", () => {
  it("réservées aux moments marquants", () => {
    expect(["NEW_RANKER", "NEW_HIGH_RANKER", "TOURNAMENT_WIN", "RECORD"].every(isPublicAnnouncementAllowed)).toBe(true);
    expect(isPublicAnnouncementAllowed("SESSION_CREATED")).toBe(false);
  });
});

describe("jamais @everyone", () => {
  it("retire everyone de parse", () => {
    expect(stripEveryoneParse(["everyone", "roles"])).toEqual(["roles"]);
    expect(stripEveryoneParse(undefined)).toEqual([]);
  });
  it("neutralise @everyone et @here dans le texte", () => {
    const out = neutralizeEveryoneText("@everyone et @HERE, mais pas everyone");
    expect(out).not.toMatch(/@everyone/i);
    expect(out).not.toMatch(/@here/i);
    expect(out).toContain("pas everyone");
  });
});

describe("ping de rôle de jeu opt-in", () => {
  const roles = [role("1", "Deadlock"), role("2", "Admin", { permissions: String(1 << 3) }), role("3", "Deadlock Doublon"), role("4", "deadlock")];

  it("aucun ping sans abonné opt-in", () => {
    expect(buildGameRolePing({ gameName: "Valorant", roles: [role("9", "Valorant")], optedInCount: 0 })).toBeNull();
  });
  it("mentionne uniquement le rôle précis, jamais en parse", () => {
    const ping = buildGameRolePing({ gameName: "Valorant", roles: [role("9", "Valorant")], optedInCount: 2 });
    expect(ping).toEqual({ content: "<@&9>", allowedMentions: { parse: [], roles: ["9"] } });
  });
  it("refuse en cas d'ambiguïté (deux rôles de même nom normalisé)", () => {
    expect(buildGameRolePing({ gameName: "Deadlock", roles, optedInCount: 3 })).toBeNull();
  });
  it("refuse un rôle sensible même s'il porte le nom du jeu", () => {
    const ping = buildGameRolePing({ gameName: "Staff", roles: [role("7", "Staff")], optedInCount: 5 });
    expect(ping).toBeNull();
  });
  it("aucun rôle correspondant : aucun ping", () => {
    expect(buildGameRolePing({ gameName: "Minecraft", roles, optedInCount: 5 })).toBeNull();
  });
});

describe("mentions de rôle : seulement celles d'un ping de jeu opt-in (Q19, D09)", () => {
  it("le ping produit par buildGameRolePing est approuvé ; un objet copié ou reconstruit ne l'est pas", () => {
    const ping = buildGameRolePing({ gameName: "Valorant", roles: [role("9", "Valorant")], optedInCount: 2 });
    expect(ping).not.toBeNull();
    expect(isApprovedRolePing(ping!.allowedMentions)).toBe(true);
    expect(isApprovedRolePing({ ...ping!.allowedMentions })).toBe(false);
    expect(isApprovedRolePing({ parse: [], roles: ["9"] })).toBe(false);
  });
});
