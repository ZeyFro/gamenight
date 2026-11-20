import { describe, expect, it } from "vitest";
import {
  APPLICATION_EXPIRY_AFTER_MS, APPLICATION_REMINDER_AFTER_MS, MAX_TEAM_RECRUITERS, applicationApproverIds, applicationLifecycleStep,
  isTeamRecruitersEnabled, recruiterNominationBlock, teamApplicationNoticesEnabled, teamGuestBlock,
} from "./team-recruiters-rules";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("drapeau TEAM_RECRUITERS_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    expect(isTeamRecruitersEnabled(env(value === undefined ? {} : { TEAM_RECRUITERS_ENABLED: value }))).toBe(expected);
  });

  it("les MP exigent aussi candidatures, executor et jeton du bot", () => {
    const all = { TEAM_RECRUITERS_ENABLED: "true", TEAM_APPLICATIONS_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x" };
    expect(teamApplicationNoticesEnabled(env(all))).toBe(true);
    for (const key of Object.keys(all)) {
      const partial: Record<string, string> = { ...all };
      delete partial[key];
      expect(teamApplicationNoticesEnabled(env(partial)), key).toBe(false);
    }
    expect(teamApplicationNoticesEnabled(env({ ...all, DISCORD_BOT_TOKEN: "  " }))).toBe(false);
  });
});

describe("cycle de vie d'une candidature en attente", () => {
  const createdAt = new Date("2026-12-01T10:00:00Z");
  const at = (ms: number) => new Date(createdAt.getTime() + ms);

  it("rien avant 48 h", () => {
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: null }, at(APPLICATION_REMINDER_AFTER_MS - 1))).toBe("none");
  });
  it("relance à 48 h, une seule fois", () => {
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: null }, at(APPLICATION_REMINDER_AFTER_MS))).toBe("remind");
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: at(APPLICATION_REMINDER_AFTER_MS) }, at(APPLICATION_REMINDER_AFTER_MS + 3_600_000))).toBe("none");
  });
  it("expire à 7 jours, relancée ou non", () => {
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: null }, at(APPLICATION_EXPIRY_AFTER_MS))).toBe("expire");
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: at(APPLICATION_REMINDER_AFTER_MS) }, at(APPLICATION_EXPIRY_AFTER_MS + 1))).toBe("expire");
    expect(applicationLifecycleStep({ createdAt, reminderSentAt: null }, at(APPLICATION_EXPIRY_AFTER_MS - 1))).toBe("remind");
  });
  it("les durées décidées sont 48 h et 7 jours", () => {
    expect(APPLICATION_REMINDER_AFTER_MS).toBe(48 * 3600_000);
    expect(APPLICATION_EXPIRY_AFTER_MS).toBe(7 * 24 * 3600_000);
  });
});

describe("décideurs", () => {
  it("responsable et recruteurs sans doublon ni vide", () => {
    expect(applicationApproverIds({ leaderId: "c", recruiterIds: ["r1", "c", "r2"] }).sort()).toEqual(["c", "r1", "r2"]);
    expect(applicationApproverIds({ leaderId: null, recruiterIds: [] })).toEqual([]);
  });
});

describe("nomination d'un recruteur", () => {
  const ok = { actorIsLeader: true, targetIsLeader: false, targetIsActiveMember: true, alreadyRecruiter: false, currentCount: 0 };
  it("autorise jusqu'à 2 recruteurs", () => {
    expect(MAX_TEAM_RECRUITERS).toBe(2);
    expect(recruiterNominationBlock(ok)).toBeNull();
    expect(recruiterNominationBlock({ ...ok, currentCount: 1 })).toBeNull();
    expect(recruiterNominationBlock({ ...ok, currentCount: 2 })).toBe("limit");
  });
  it.each([
    [{ actorIsLeader: false }, "forbidden"], [{ targetIsLeader: true }, "self_leader"],
    [{ targetIsActiveMember: false }, "not_member"], [{ alreadyRecruiter: true }, "already"],
  ] as const)("refuse %j : %s", (patch, expected) => {
    expect(recruiterNominationBlock({ ...ok, ...patch })).toBe(expected);
  });
});

describe("invité de tournoi", () => {
  const ok = { actorIsLeader: true, tournamentRegistrationOpen: true, targetIsTeamMember: false, targetIsActive: true, existingStatus: null, rosterSize: 4 } as const;
  it("autorise un joueur d'une autre équipe", () => {
    expect(teamGuestBlock(ok)).toBeNull();
    expect(teamGuestBlock({ ...ok, existingStatus: "DECLINED" })).toBeNull();
    expect(teamGuestBlock({ ...ok, existingStatus: "REVOKED" })).toBeNull();
  });
  it.each([
    [{ actorIsLeader: false }, "forbidden"], [{ tournamentRegistrationOpen: false }, "tournament_closed"],
    [{ targetIsTeamMember: true }, "already_member"], [{ targetIsActive: false }, "not_active"],
    [{ existingStatus: "INVITED" }, "already_guest"], [{ existingStatus: "ACCEPTED" }, "already_guest"],
    [{ rosterSize: 8 }, "roster_full"],
  ] as const)("refuse %j : %s", (patch, expected) => {
    expect(teamGuestBlock({ ...ok, ...patch })).toBe(expected);
  });
});
