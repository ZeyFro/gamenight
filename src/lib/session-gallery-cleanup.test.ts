import { afterEach, describe, expect, it, vi } from "vitest";

const { del, warn } = vi.hoisted(() => ({ del: vi.fn(), warn: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del }));
vi.mock("@/lib/logger", () => ({ logger: { warn } }));

import { deleteSessionGalleryBlobs } from "@/lib/session-gallery";

const originalToken = process.env.SESSION_MEDIA_BLOB_TOKEN;
afterEach(() => {
  if (originalToken === undefined) delete process.env.SESSION_MEDIA_BLOB_TOKEN;
  else process.env.SESSION_MEDIA_BLOB_TOKEN = originalToken;
  del.mockReset();
  warn.mockReset();
});

describe("private session gallery cleanup", () => {
  it("does not contact Blob without its private token", async () => {
    delete process.env.SESSION_MEDIA_BLOB_TOKEN;
    await deleteSessionGalleryBlobs(["sessions/one/file"]);
    expect(del).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("deletes only stored paths using the private access mode", async () => {
    process.env.SESSION_MEDIA_BLOB_TOKEN = "test-private-token";
    del.mockResolvedValue(undefined);
    await deleteSessionGalleryBlobs(["sessions/one/file"]);
    expect(del).toHaveBeenCalledWith("sessions/one/file", { access: "private", token: "test-private-token" });
    expect(warn).not.toHaveBeenCalled();
  });
});
