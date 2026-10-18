import { describe, expect, it } from "vitest";
import { detectSessionGalleryMime, isSessionGalleryConsent } from "@/lib/session-gallery";

describe("session gallery upload validation", () => {
  it("detects supported image signatures rather than trusting the browser MIME", () => {
    expect(detectSessionGalleryMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(detectSessionGalleryMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectSessionGalleryMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(detectSessionGalleryMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectSessionGalleryMime(Uint8Array.from([0x4d, 0x5a, 0, 0]))).toBeNull();
  });

  it("requires an explicit access consent", () => {
    expect(isSessionGalleryConsent("on")).toBe(true);
    expect(isSessionGalleryConsent(null)).toBe(false);
  });
});
