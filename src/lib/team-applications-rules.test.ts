import { afterEach, describe, expect, it, vi } from "vitest";
import { isTeamApplicationsEnabled, resolveTeamLeaderId, teamApplicationBlock, teamApplicationSchema } from "./team-applications-rules";

afterEach(() => vi.unstubAllEnvs());

describe("drapeau TEAM_APPLICATIONS_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    vi.stubEnv("TEAM_APPLICATIONS_ENABLED", value as string);
    expect(isTeamApplicationsEnabled()).toBe(expected);
  });
});

describe("message de candidature", () => {
  it("accepte 1 à 500 caractères, rognés", () => {
    expect(teamApplicationSchema.parse({ teamId: "t", message: "  Salut  " }).message).toBe("Salut");
    expect(teamApplicationSchema.safeParse({ teamId: "t", message: "x".repeat(500) }).success).toBe(true);
  });
  it.each([["", "vide"], ["   ", "espaces seuls"], ["x".repeat(501), "trop long"]])("refuse un message %#: %s", message => {
    expect(teamApplicationSchema.safeParse({ teamId: "t", message }).success).toBe(false);
  });
  it("refuse une équipe absente", () => {
    expect(teamApplicationSchema.safeParse({ teamId: "", message: "ok" }).success).toBe(false);
  });
});

describe("responsable d'équipe", () => {
  it("le créateur actif reste responsable", () => {
    expect(resolveTeamLeaderId({ createdById: "a", creatorIsActive: true, oldestActiveMemberId: "b" })).toBe("a");
  });
  it("sinon le membre actif le plus ancien, ou personne", () => {
    expect(resolveTeamLeaderId({ createdById: "a", creatorIsActive: false, oldestActiveMemberId: "b" })).toBe("b");
    expect(resolveTeamLeaderId({ createdById: "a", creatorIsActive: false, oldestActiveMemberId: null })).toBeNull();
  });
});

describe("conditions pour postuler", () => {
  const base = { isMember: false, isRecruiting: true, activeMembers: 2, maxMembers: 4, existingStatus: null } as const;
  it("autorise une première candidature", () => {
    expect(teamApplicationBlock(base)).toBeNull();
  });
  it.each(["DECLINED", "WITHDRAWN", "ACCEPTED"] as const)("autorise de repostuler après une candidature %s", existingStatus => {
    expect(teamApplicationBlock({ ...base, existingStatus })).toBeNull();
  });
  it("refuse un membre, un recrutement fermé, une équipe complète et un doublon en attente", () => {
    expect(teamApplicationBlock({ ...base, isMember: true })).toBe("already_member");
    expect(teamApplicationBlock({ ...base, isRecruiting: false })).toBe("closed");
    expect(teamApplicationBlock({ ...base, activeMembers: 4 })).toBe("full");
    expect(teamApplicationBlock({ ...base, existingStatus: "PENDING" })).toBe("pending");
  });
});
