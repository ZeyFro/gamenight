import { describe, expect, it } from "vitest";
import {
  detectSessionGalleryMime,
  isSessionGalleryConsent,
  isSessionVideoEnabled,
  parseSessionGalleryRange,
} from "@/lib/session-gallery";

describe("session gallery upload validation", () => {
  it("detects supported image signatures rather than trusting the browser MIME", () => {
    expect(detectSessionGalleryMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(detectSessionGalleryMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectSessionGalleryMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(detectSessionGalleryMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectSessionGalleryMime(Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]), 20)).toBe("video/mp4");
    expect(detectSessionGalleryMime(Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0]), 20)).toBeNull();
    expect(detectSessionGalleryMime(Uint8Array.from([0x4d, 0x5a, 0, 0]))).toBeNull();
  });

  it("enables videos only when the flag is exactly true", () => {
    expect(isSessionVideoEnabled({ SESSION_VIDEO_ENABLED: "true" })).toBe(true);
    expect(isSessionVideoEnabled({ SESSION_VIDEO_ENABLED: "TRUE" })).toBe(false);
    expect(isSessionVideoEnabled({ SESSION_VIDEO_ENABLED: "1" })).toBe(false);
    expect(isSessionVideoEnabled({})).toBe(false);
  });

  it("parses single, open-ended and suffix byte ranges and rejects invalid ranges", () => {
    expect(parseSessionGalleryRange("bytes=1-3", 8)).toEqual({ start: 1, end: 3 });
    expect(parseSessionGalleryRange("bytes=4-", 8)).toEqual({ start: 4, end: 7 });
    expect(parseSessionGalleryRange("bytes=-2", 8)).toEqual({ start: 6, end: 7 });
    expect(parseSessionGalleryRange("bytes=8-9", 8)).toBeNull();
    expect(parseSessionGalleryRange("bytes=-0", 8)).toBeNull();
    expect(parseSessionGalleryRange("bytes=1-2,4-5", 8)).toBeNull();
  });

  it("requires an explicit access consent", () => {
    expect(isSessionGalleryConsent("on")).toBe(true);
    expect(isSessionGalleryConsent(null)).toBe(false);
  });
});
