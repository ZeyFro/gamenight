import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getSessionAccessRole: vi.fn(),
  statsCommunityIdForSession: vi.fn(),
  getScopedPrisma: vi.fn(),
  findActiveMembership: vi.fn(),
  communityFindUnique: vi.fn(),
  galleryCount: vi.fn(),
  galleryCreate: vi.fn(),
  galleryFindFirst: vi.fn(),
  galleryDelete: vi.fn(),
  queryRaw: vi.fn(),
  sessionCommunityId: "community-1" as string | null,
  sessionCreatorId: "member-1",
  memberRole: "MEMBER",
  memberStatus: "ACTIVE",
  inviteStatus: "ACTIVE",
  communityStatus: "ACTIVE",
  galleryEnabled: true,
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  revalidatePath: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole: mocks.getSessionAccessRole }));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: mocks.statsCommunityIdForSession }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: mocks.getScopedPrisma }));
vi.mock("@/lib/community-access", () => ({ findActiveMembership: mocks.findActiveMembership, hasCommunityRole: (role: string) => role === "ADMIN" || role === "OWNER" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (work: (tx: unknown) => unknown) => work({
      $queryRaw: mocks.queryRaw,
      sessionGalleryMedia: { count: mocks.galleryCount, create: mocks.galleryCreate },
    }),
    community: { findUnique: mocks.communityFindUnique },
    sessionGalleryMedia: { count: mocks.galleryCount, create: mocks.galleryCreate, findFirst: mocks.galleryFindFirst, delete: mocks.galleryDelete },
  },
}));

import { deleteSessionGalleryImageAction, uploadSessionGalleryImageAction } from "./gallery";

const mp4 = new File([Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" });

describe("session gallery video uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in test"); }));
    vi.stubEnv("SESSION_MEDIA_BLOB_TOKEN", "private-test-token");
    vi.stubEnv("SESSION_VIDEO_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    mocks.sessionCommunityId = "community-1";
    mocks.sessionCreatorId = "member-1";
    mocks.memberRole = "MEMBER";
    mocks.memberStatus = "ACTIVE";
    mocks.inviteStatus = "ACTIVE";
    mocks.communityStatus = "ACTIVE";
    mocks.galleryEnabled = true;
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes('FROM "Community"')) return [{ status: mocks.communityStatus, sessionGalleryEnabled: mocks.galleryEnabled }];
      if (sql.includes('FROM "Membership"')) return [{ status: mocks.memberStatus, role: mocks.memberRole }];
      if (sql.includes('FROM "SessionInvite"')) return [{ status: mocks.inviteStatus }];
      if (sql.includes('FROM "Session"')) return [{ createdById: mocks.sessionCreatorId, communityId: mocks.sessionCommunityId }];
      throw new Error("Unexpected authorization query");
    });
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.getSessionAccessRole.mockResolvedValue("creator");
    mocks.findActiveMembership.mockResolvedValue({ role: "MEMBER" });
    mocks.statsCommunityIdForSession.mockResolvedValue("community-1");
    mocks.getScopedPrisma.mockResolvedValue({ session: { findUnique: vi.fn().mockResolvedValue({ communityId: "community-1", createdById: "creator-1" }) } });
    mocks.communityFindUnique.mockResolvedValue({ sessionGalleryEnabled: true });
    mocks.galleryCount.mockResolvedValue(0);
    mocks.put.mockResolvedValue({ pathname: "sessions/session-1/clip" });
    mocks.del.mockResolvedValue(undefined);
    mocks.galleryCreate.mockResolvedValue({ id: "media-1" });
    mocks.galleryFindFirst.mockResolvedValue({ id: "media-1", uploadedById: "member-1", pathname: "sessions/session-1/media" });
    mocks.galleryDelete.mockResolvedValue({ id: "media-1" });
  });

  it("rejects MP4 uploads while the feature flag is off", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");

    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=video-desactive");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects gallery uploads by invited guests", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.getSessionAccessRole.mockResolvedValue("guest");
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");

    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("does not let an invited uploader delete gallery media", async () => {
    mocks.getSessionAccessRole.mockResolvedValue("guest");
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("mediaId", "media-1");

    await expect(deleteSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions");
    expect(mocks.galleryDelete).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("stores MP4 privately after consent when videos are enabled", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");

    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=ok");
    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^sessions\/session-1\//), mp4, {
      access: "private",
      token: "private-test-token",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    expect(mocks.galleryCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ mimeType: "video/mp4", sizeBytes: mp4.size }) });
  });

  it.each(["ADMIN", "OWNER"])("lets an invited community %s upload and delete media", async role => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.getSessionAccessRole.mockResolvedValue("guest");
    mocks.findActiveMembership.mockResolvedValue({ role });
    mocks.memberRole = role;
    mocks.sessionCreatorId = "creator-1";
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");
    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=ok");
    expect(mocks.findActiveMembership).toHaveBeenCalledWith("member-1", "community-1");
    form.set("mediaId", "media-1");
    await expect(deleteSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=ok");
    expect(mocks.galleryDelete).toHaveBeenCalledWith({ where: { id: "media-1" } });
  });

  it("does not grant a community admin access to a private uninvited session", async () => {
    mocks.getSessionAccessRole.mockResolvedValue(null);
    mocks.findActiveMembership.mockResolvedValue({ role: "ADMIN" });
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");
    form.set("mediaId", "media-1");
    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions");
    await expect(deleteSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.galleryDelete).not.toHaveBeenCalled();
    expect(mocks.findActiveMembership).not.toHaveBeenCalled();
  });

  it("rejects an invited former community admin after membership removal", async () => {
    mocks.getSessionAccessRole.mockResolvedValue("guest");
    mocks.findActiveMembership.mockResolvedValue(null);
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("mediaId", "media-1");
    await expect(deleteSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions");
    expect(mocks.galleryDelete).not.toHaveBeenCalled();
  });

  it("keeps creator deletion without a community admin role", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("mediaId", "media-1");
    await expect(deleteSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=ok");
    expect(mocks.galleryDelete).toHaveBeenCalledWith({ where: { id: "media-1" } });
    expect(mocks.findActiveMembership).not.toHaveBeenCalled();
  });

  it("uploads historical sessions through the default community", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.sessionCommunityId = null;
    mocks.getScopedPrisma.mockResolvedValue({ session: { findUnique: vi.fn().mockResolvedValue({ communityId: null }) } });
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");
    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=ok");
    expect(mocks.statsCommunityIdForSession).toHaveBeenCalledWith(null);
    expect(mocks.galleryCreate).toHaveBeenCalledOnce();
  });

  it.each(["demotion", "membership", "invitation", "suspension", "gallery disabled"])("cleans uploaded Blob without persisting media after %s during upload", async change => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.getSessionAccessRole.mockResolvedValue("guest");
    mocks.findActiveMembership.mockResolvedValue({ role: "ADMIN" });
    mocks.memberRole = "ADMIN";
    mocks.sessionCreatorId = "creator-1";
    mocks.put.mockImplementationOnce(async () => {
      if (change === "demotion") mocks.memberRole = "MEMBER";
      if (change === "membership") mocks.memberStatus = "REMOVED";
      if (change === "invitation") mocks.inviteStatus = "REVOKED";
      if (change === "suspension") mocks.communityStatus = "SUSPENDED";
      if (change === "gallery disabled") mocks.galleryEnabled = false;
      return { pathname: "sessions/session-1/clip" };
    });
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");
    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=echec");
    expect(mocks.galleryCreate).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledWith("sessions/session-1/clip", { token: "private-test-token" });
  });

  it("rechecks the eight-media limit after upload before storing a ninth item", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.galleryCount.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");
    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=echec");
    expect(mocks.galleryCreate).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledOnce();
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
});
