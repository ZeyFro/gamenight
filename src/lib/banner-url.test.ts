import { describe, expect, it } from "vitest";
import { bannerUrlSchema } from "@/lib/validations";
import {
  BANNER_HOST_MESSAGE,
  BANNER_HTTPS_MESSAGE,
  findBannerUrlProblem,
  KLIPY_PAGE_URL_MESSAGE,
} from "@/lib/banner-url";

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
    "https://media.discordapp.net/attachments/1/2/x.png",
    "https://media.tenor.com/abc/x.gif",
    "https://media4.giphy.com/media/abc/giphy.gif",
    "https://abc123.public.blob.vercel-storage.com/banners/u.png",
    "pas une url",
    "",
  ])("lien média d'un hébergeur autorisé / invalide (format validé ailleurs) accepté ici : %s", (url) => {
    expect(findBannerUrlProblem(url)).toBeNull();
  });
});

describe("liste blanche d'hôtes + https uniquement", () => {
  it.each([
    "https://exemple.com/klipy.com/page.png",
    "https://evil.example/pixel.gif",
    "https://i.imgur.com.evil.example/a.png",
    "https://evilimgur.com/a.png",
    "https://169.254.169.254/latest",
    "https://localhost/a.png",
    "https://user:pw@i.imgur.com@evil.example/a.png",
  ])("hôte non autorisé refusé : %s", (url) => {
    expect(findBannerUrlProblem(url)).toBe(BANNER_HOST_MESSAGE);
  });

  it.each(["http://i.imgur.com/a.png", "HTTP://static.klipy.com/a.gif"])("http refusé : %s", (url) => {
    expect(findBannerUrlProblem(url)).toBe(BANNER_HTTPS_MESSAGE);
  });

  it("refus relayé par bannerUrlSchema", () => {
    const result = bannerUrlSchema.safeParse({ bannerUrl: "https://evil.example/p.gif" });
    expect(result.success).toBe(false);
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
