import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communities: vi.fn(),
  pending: vi.fn(),
  update: vi.fn(),
  stale: vi.fn(),
  approvers: vi.fn(),
  notice: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findMany: mocks.communities } } }));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({ teamApplication: { findMany: mocks.pending, updateMany: mocks.update }, communityTeamMember: { findMany: mocks.stale } }),
}));
vi.mock("@/lib/team-application-approvers", () => ({ listApplicationApproverIds: mocks.approvers }));
vi.mock("@/lib/team-application-notify", () => ({ enqueueTeamApplicationNotice: mocks.notice }));
vi.mock("@/lib/discord-team-space-hooks", () => ({ requestTeamSpaceMemberSync: mocks.sync }));

import { runTeamApplicationLifecycle } from "./team-application-lifecycle";

const H = 3600_000;
const now = new Date("2026-12-10T12:00:00Z");
const app = (id: string, ageHours: number, reminderSentAt: Date | null = null) =>
  ({ id, teamId: `t-${id}`, applicantId: `u-${id}`, createdAt: new Date(now.getTime() - ageHours * H), reminderSentAt });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.communities.mockResolvedValue([{ id: "c1" }]);
  mocks.pending.mockResolvedValue([]);
  mocks.stale.mockResolvedValue([]);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.approvers.mockResolvedValue(["captain", "u-r1", "recruiter"]);
  mocks.notice.mockResolvedValue("queued");
});

describe("runTeamApplicationLifecycle", () => {
  it("expire à 7 jours avec garde sur le statut et la date de dépôt, sans MP", async () => {
    const old = app("a", 24 * 7);
    mocks.pending.mockResolvedValue([old]);
    const report = await runTeamApplicationLifecycle(now);
    expect(report).toMatchObject({ expired: 1, reminded: 0 });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "a", communityId: "c1", status: "PENDING", createdAt: old.createdAt }, data: { status: "EXPIRED", decidedAt: now },
    });
    expect(mocks.notice).not.toHaveBeenCalled();
  });

  it("relance une seule fois à 48 h : MP aux décideurs (sans le candidat) puis marque la relance", async () => {
    const waiting = app("b", 50);
    mocks.approvers.mockResolvedValue(["captain", "u-b", "recruiter"]);
    mocks.pending.mockResolvedValue([waiting, app("c", 60, new Date(now.getTime() - 10 * H)), app("d", 10)]);
    const report = await runTeamApplicationLifecycle(now);
    expect(report).toMatchObject({ reminded: 1, expired: 0 });
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    expect(mocks.notice).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "b", kind: "reminder", recipientIds: ["captain", "recruiter"] }));
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "b", communityId: "c1", status: "PENDING", createdAt: waiting.createdAt, reminderSentAt: null }, data: { reminderSentAt: now },
    });
  });

  it("file éteinte : la relance n'est pas consommée", async () => {
    mocks.pending.mockResolvedValue([app("b", 50)]);
    mocks.notice.mockResolvedValue("disabled");
    const report = await runTeamApplicationLifecycle(now);
    expect(report.reminded).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("une candidature décidée ou renvoyée entre-temps n'est pas comptée", async () => {
    mocks.pending.mockResolvedValue([app("a", 24 * 8)]);
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await runTeamApplicationLifecycle(now)).expired).toBe(0);
  });

  it("demande le retrait d'accès des membres non actifs, sans appel Discord direct", async () => {
    mocks.stale.mockResolvedValue([{ teamId: "t1", user: { discordId: "100000000000000001" } }, { teamId: "t2", user: { discordId: "100000000000000002" } }]);
    const report = await runTeamApplicationLifecycle(now);
    expect(report.accessRequests).toBe(2);
    expect(mocks.sync).toHaveBeenCalledWith({ communityId: "c1", teamId: "t1", discordId: "100000000000000001" });
    expect(mocks.sync).toHaveBeenCalledWith({ communityId: "c1", teamId: "t2", discordId: "100000000000000002" });
  });

  it("ne traite que les communautés actives avec équipes", async () => {
    await runTeamApplicationLifecycle(now);
    expect(mocks.communities).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "ACTIVE", communityTeamsEnabled: true } }));
  });
});
