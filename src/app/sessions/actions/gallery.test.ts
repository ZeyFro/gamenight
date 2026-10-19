import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getSessionAccessRole: vi.fn(),
  statsCommunityIdForSession: vi.fn(),
  getScopedPrisma: vi.fn(),
  communityFindUnique: vi.fn(),
  galleryCount: vi.fn(),
  galleryCreate: vi.fn(),
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
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique: mocks.communityFindUnique },
    sessionGalleryMedia: { count: mocks.galleryCount, create: mocks.galleryCreate },
  },
}));

import { uploadSessionGalleryImageAction } from "./gallery";

const mp4 = new File([Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" });

describe("session gallery video uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in test"); }));
    vi.stubEnv("SESSION_MEDIA_BLOB_TOKEN", "private-test-token");
    vi.stubEnv("SESSION_VIDEO_ENABLED", "false");
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.getSessionAccessRole.mockResolvedValue("INVITEE");
    mocks.statsCommunityIdForSession.mockResolvedValue("community-1");
    mocks.getScopedPrisma.mockResolvedValue({ session: { findUnique: vi.fn().mockResolvedValue({ communityId: "community-1" }) } });
    mocks.communityFindUnique.mockResolvedValue({ sessionGalleryEnabled: true });
    mocks.galleryCount.mockResolvedValue(0);
    mocks.put.mockResolvedValue({ pathname: "sessions/session-1/clip" });
    mocks.galleryCreate.mockResolvedValue({ id: "media-1" });
  });

  it("rejects MP4 uploads while the feature flag is off", async () => {
    const form = new FormData();
    form.set("sessionId", "session-1");
    form.set("media", mp4);
    form.set("consent", "on");

    await expect(uploadSessionGalleryImageAction(form)).rejects.toThrow("REDIRECT:/sessions/session-1?gallery=video-desactive");
    expect(mocks.put).not.toHaveBeenCalled();
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

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
});
