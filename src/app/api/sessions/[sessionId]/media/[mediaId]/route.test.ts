import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getCurrentUser: vi.fn(),
  getSessionAccessRole: vi.fn(),
  getScopedPrisma: vi.fn(),
  communityFindUnique: vi.fn(),
  mediaFindFirst: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ get: mocks.get }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole: mocks.getSessionAccessRole }));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: vi.fn((id: string) => id) }));
vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: mocks.getScopedPrisma,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique: mocks.communityFindUnique },
    sessionGalleryMedia: { findFirst: mocks.mediaFindFirst },
  },
}));

import { GET } from "./route";

describe("private session gallery image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in test"); }));
    vi.stubEnv("SESSION_MEDIA_BLOB_TOKEN", "private-test-token");
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.getSessionAccessRole.mockResolvedValue("INVITEE");
    mocks.getScopedPrisma.mockResolvedValue({
      session: { findUnique: vi.fn().mockResolvedValue({ communityId: "community-1" }) },
    });
    mocks.communityFindUnique.mockResolvedValue({ sessionGalleryEnabled: true });
    mocks.mediaFindFirst.mockResolvedValue({ pathname: "sessions/session-1/image-1", mimeType: "image/jpeg", sizeBytes: 3 });
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("img"));
          controller.close();
        },
      }),
    });
  });

  it("returns the private image only to an active session participant", async () => {
    const response = await GET(new Request("https://gamenight.test/image"), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "image-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("img");
    expect(mocks.get).toHaveBeenCalledWith("sessions/session-1/image-1", {
      access: "private",
      token: "private-test-token",
    });
  });

  it("conceals gallery media from non-participants", async () => {
    mocks.getSessionAccessRole.mockResolvedValue(null);

    const response = await GET(new Request("https://gamenight.test/image"), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "image-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("returns a private video byte range for seeking", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.mediaFindFirst.mockResolvedValue({ pathname: "sessions/session-1/clip-1", mimeType: "video/mp4", sizeBytes: 5 });
    mocks.get.mockResolvedValue({
      statusCode: 200,
      headers: new Headers(),
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("abcde"));
          controller.close();
        },
      }),
    });

    const response = await GET(new Request("https://gamenight.test/video", { headers: { Range: "bytes=1-2" } }), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "clip-1" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-2/5");
    expect(response.headers.get("Content-Length")).toBe("2");
    expect(await response.text()).toBe("bc");
    expect(mocks.get).toHaveBeenCalledWith("sessions/session-1/clip-1", { access: "private", token: "private-test-token" });
  });

  it("supports suffix ranges and rejects invalid ranges with 416", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "true");
    mocks.mediaFindFirst.mockResolvedValue({ pathname: "sessions/session-1/clip-1", mimeType: "video/mp4", sizeBytes: 5 });
    mocks.get.mockResolvedValue({ statusCode: 200, headers: new Headers(), stream: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("abcde")); controller.close(); },
    }) });

    const suffix = await GET(new Request("https://gamenight.test/video", { headers: { Range: "bytes=-2" } }), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "clip-1" }),
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("Content-Range")).toBe("bytes 3-4/5");
    expect(await suffix.text()).toBe("de");

    const invalid = await GET(new Request("https://gamenight.test/video", { headers: { Range: "bytes=5-8" } }), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "clip-1" }),
    });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("Content-Range")).toBe("bytes */5");
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("does not serve stored videos while the video flag is off", async () => {
    vi.stubEnv("SESSION_VIDEO_ENABLED", "false");
    mocks.mediaFindFirst.mockResolvedValue({ pathname: "sessions/session-1/clip-1", mimeType: "video/mp4", sizeBytes: 5 });

    const response = await GET(new Request("https://gamenight.test/video"), {
      params: Promise.resolve({ sessionId: "session-1", mediaId: "clip-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
});
