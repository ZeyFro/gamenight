import { describe, expect, it } from "vitest";
import { bannerUrlSchema } from "@/lib/validations";
import { findBannerUrlProblem, KLIPY_PAGE_URL_MESSAGE } from "@/lib/banner-url";

describe("findBannerUrlProblem", () => {
  it.each([
    "https://klipy.com/gifs/ai-dog-dog-ai-1",
    "https://www.klipy.com/gifs/anime-girl-anime-girl-blush-1",
    "http://KLIPY.com/gifs/x",
    "  https://klipy.com/gifs/x  ",
  ])("lien de PAGE klipy refusé : %s", (url) => {
    expect(findBannerUrlProblem(url)).toBe(KLIPY_PAGE_URL_MESSAGE);
  });

  it.each([
    "https://static.klipy.com/ii/35ccce3d852f7995dd2da910f2abd795/2c/59/NiBtvUhr.webp",
    "https://static.klipy.com/ii/abc/x.gif",
    "https://i.imgur.com/abc.gif",
    "https://cdn.discordapp.com/attachments/1/2/x.gif",
    "https://exemple.com/klipy.com/page.png",
    "pas une url",
    "",
  ])("lien média / autre hébergeur / invalide accepté ici : %s", (url) => {
    expect(findBannerUrlProblem(url)).toBeNull();
  });
});

describe("bannerUrlSchema", () => {
  it("refuse un lien de page klipy avec le message explicite", () => {
    const result = bannerUrlSchema.safeParse({ bannerUrl: "https://klipy.com/gifs/ai-dog-dog-ai-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(KLIPY_PAGE_URL_MESSAGE);
  });

  it("accepte le média static.klipy.com, une URL classique et le vide (retour au dégradé)", () => {
    for (const bannerUrl of ["https://static.klipy.com/ii/abc/x.webp", "https://i.imgur.com/a.png", ""]) {
      expect(bannerUrlSchema.safeParse({ bannerUrl }).success).toBe(true);
    }
  });
});
