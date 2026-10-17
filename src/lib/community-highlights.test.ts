import { afterEach, describe, expect, it, vi } from "vitest";
import { highlightInput, isCommunityHighlightsEnabled } from "./community-highlights-input";

afterEach(() => vi.unstubAllEnvs());

describe("souvenirs du serveur : saisie", () => {
  const input = { kind: "FAME", title: " Un beau clutch ", description: " À trois contre un ", mediaUrl: "" };

  it("nettoie le texte et conserve le média facultatif", () => {
    expect(highlightInput.parse(input)).toEqual({ kind: "FAME", title: "Un beau clutch", description: "À trois contre un", mediaUrl: null });
    expect(highlightInput.parse({ ...input, kind: "SHAME", mediaUrl: "https://example.org/clip" }).mediaUrl).toBe("https://example.org/clip");
  });

  it.each([
    { title: " " }, { title: "x".repeat(121) }, { description: " " },
    { description: "x".repeat(4001) }, { kind: "ADMIN" },
    { mediaUrl: "javascript:alert(1)" }, { mediaUrl: "http://example.org/clip" },
    { mediaUrl: "https://user:password@example.org/clip" }, { communityId: "autre-serveur" },
  ])("refuse une saisie invalide %j", (change) => {
    expect(highlightInput.safeParse({ ...input, ...change }).success).toBe(false);
  });

  it("reste désactivé sauf true exact", () => {
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "false");
    expect(isCommunityHighlightsEnabled()).toBe(false);
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "TRUE");
    expect(isCommunityHighlightsEnabled()).toBe(false);
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "true");
    expect(isCommunityHighlightsEnabled()).toBe(true);
  });
});
